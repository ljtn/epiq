import {chmodSync, existsSync, lstatSync, mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {failed, Result, succeeded} from '../model/result-types.js';

/**
 * A directory under the system temp dir that only this user can enter.
 *
 * `os.tmpdir()` is per-user on macOS but shared on Linux, where the default
 * 0755 left whatever epiq wrote there — a private repository's diffs — readable
 * by every local account, and let one of them pre-create a path as a symlink so
 * the write landed on a file of their choosing.
 *
 * The mode is set on creation *and* on a directory that was already there: an
 * older build made these 0755, and `mkdirSync` leaves an existing directory's
 * permissions alone, so the loose one would have outlived the fix. A symlink is
 * refused outright rather than chmod-ed — following one is the thing being
 * prevented.
 */
export const privateTempDir = (...segments: string[]): Result<string> => {
	const dir = path.join(os.tmpdir(), 'epiq', ...segments);

	try {
		if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
			return failed(`Refusing to write through a symlink at ${dir}`);
		}

		mkdirSync(dir, {recursive: true, mode: 0o700});
		chmodSync(dir, 0o700);

		return succeeded('Prepared private temp dir', dir);
	} catch (error) {
		return failed(
			`Unable to prepare ${dir}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
};
