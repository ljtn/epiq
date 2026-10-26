import {chmodSync, existsSync, lstatSync, mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {failed, Result, succeeded} from '../model/result-types.js';

/**
 * A temp directory only this user can enter (`os.tmpdir()` is shared on Linux).
 * The mode is enforced on an existing directory too, and a symlink is refused.
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
