import {execGitAllowFail} from '../../git/git-utils.js';
import {normalizeEmail} from '../model/email-link.js';

/**
 * What git in this repository is configured to sign commits as.
 *
 * Read once per boot and kept in the settings store, never on the write path.
 * `ensureContributorCurrent` runs on every write and deliberately reads that
 * store rather than config, to keep the config module graph out of every
 * caller; a git subprocess per write would be worse than what that avoided,
 * and it would not show up in a test — only under the batch writes a real
 * board does.
 *
 * `allowFail`, because a repository with no `user.email` is ordinary and not an
 * error: nothing is linked, and commits keep showing their raw author name.
 */
export type GitIdentity = {name: string | null; email: string | null};

type Cached = GitIdentity & {readAt: number};

const byRepo = new Map<string, Cached>();

// Long enough that a boot per request costs nothing, short enough that somebody
// who has just fixed a wrong `user.email` sees it take effect without
// restarting. An unbounded cache made that a restart, which is the sort of
// thing people work around rather than report.
const CACHE_MS = 30_000;

/**
 * Both halves, in one read.
 *
 * Cached per repository, because `boot()` runs on every MCP call and every
 * socket message, above the fast path that exists to avoid redundant work: an
 * uncached read here spawns a git process per request to answer the same thing
 * every time. Together, because they are always wanted together and come from
 * the same file, so asking twice buys nothing.
 */
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

/**
 * The git author name, used to propose a board name at setup and to recognise
 * which addresses in a history are yours. Never written over a name the user
 * already has.
 */
export const readGitName = async (cwd: string): Promise<string | null> =>
	(await readGitIdentity(cwd)).name;

/** So one test's configuration does not answer the next one's read. */
export const resetGitIdentityCacheForTests = (): void => byRepo.clear();
