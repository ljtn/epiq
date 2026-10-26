import {execGitAllowFail} from '../../git/git-utils.js';
import {normalizeEmail} from '../model/email-link.js';

/**
 * What git here signs commits as. Read at boot, never on the write path; a
 * missing `user.email` is ordinary, not an error.
 */
export type GitIdentity = {name: string | null; email: string | null};

type Cached = GitIdentity & {readAt: number};

const byRepo = new Map<string, Cached>();

// Short enough that a fixed `user.email` takes effect without a restart.
const CACHE_MS = 30_000;

/** Name and email in one read, cached per repository, since every request boots. */
export const readGitIdentity = async (cwd: string): Promise<GitIdentity> => {
	const cached = byRepo.get(cwd);
	if (cached && Date.now() - cached.readAt < CACHE_MS) {
		return {name: cached.name, email: cached.email};
	}

	const result = await execGitAllowFail({
		args: ['config', '--get-regexp', '^user\\.(name|email)$'],
		cwd,
	});

	let name: string | null = null;
	let email: string | null = null;

	if (result.exitCode === 0) {
		for (const line of (result.stdout ?? '').split('\n')) {
			const at = line.indexOf(' ');
			if (at === -1) continue;

			const key = line.slice(0, at);
			const value = line.slice(at + 1);

			// A name may hold anything but a newline, so it is trimmed and taken
			// as written. An address is stored normalized wherever it is stored.
			if (key === 'user.name') name = value.trim() || null;
			if (key === 'user.email') email = normalizeEmail(value) || null;
		}
	}

	byRepo.set(cwd, {name, email, readAt: Date.now()});
	return {name, email};
};

export const readGitEmail = async (cwd: string): Promise<string | null> =>
	(await readGitIdentity(cwd)).email;

/** The git author name, used to propose a board name and recognise your addresses. */
export const readGitName = async (cwd: string): Promise<string | null> =>
	(await readGitIdentity(cwd)).name;

/** So one test's configuration does not answer the next one's read. */
export const resetGitIdentityCacheForTests = (): void => byRepo.clear();
