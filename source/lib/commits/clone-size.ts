import fs from 'node:fs';
import path from 'node:path';
import {readEpiqConfig} from '../config/user-config.js';
import {isFail} from '../model/result-types.js';

// How much disk a connected repo's clone may take on this machine. Set here, in
// the machine's own config: the repo list comes from a committed file, and a
// cap that file could raise would be no cap.

export const DEFAULT_REPO_CLONE_MAX_MB = 2048;
export const MIN_REPO_CLONE_MAX_MB = 1;
export const MAX_REPO_CLONE_MAX_MB = 1_048_576;

export const isRepoCloneMaxMb = (value: number): boolean =>
	Number.isInteger(value) &&
	value >= MIN_REPO_CLONE_MAX_MB &&
	value <= MAX_REPO_CLONE_MAX_MB;

/** The cap in MB, its default where the config sets none or nonsense. */
export const readRepoCloneMaxMb = (): number => {
	const config = readEpiqConfig();
	const set = isFail(config) ? undefined : config.value.repoCloneMaxMb;

	return set !== undefined && isRepoCloneMaxMb(set)
		? set
		: DEFAULT_REPO_CLONE_MAX_MB;
};

/** Bytes on disk under a directory; links are counted as themselves. */
export const dirSize = (dir: string): number => {
	let total = 0;
	const visit = (current: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, {withFileTypes: true});
		} catch {
			return;
		}

		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				visit(full);
				continue;
			}

			try {
				total += fs.lstatSync(full).size;
			} catch {
				// Gone between the listing and the look: a git temp file.
			}
		}
	};

	visit(dir);
	return total;
};

/** What a repo is told when its clone would pass the cap. */
export const cloneCapMessage = (maxMb: number) =>
	`Its clone would pass this machine's ${maxMb} MB cap for a connected repo: narrow its history, or raise repoCloneMaxMb`;
