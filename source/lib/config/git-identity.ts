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
type Cached = {email: string | null; readAt: number};

const emailByRepo = new Map<string, Cached>();

// Long enough that a boot per request costs nothing, short enough that somebody
// who has just fixed a wrong `user.email` sees it take effect without
// restarting. An unbounded cache made that a restart, which is the sort of
// thing people work around rather than report.
const CACHE_MS = 30_000;

export const readGitEmail = async (cwd: string): Promise<string | null> => {
	// Cached per repository. `boot()` runs on every MCP call and every socket
	// message, above the fast path that exists to avoid redundant work, so an
	// uncached read here would spawn a git process per request to answer the
	// same thing every time.
	const cached = emailByRepo.get(cwd);
	if (cached && Date.now() - cached.readAt < CACHE_MS) return cached.email;

	const result = await execGitAllowFail({
		args: ['config', '--get', 'user.email'],
		cwd,
	});

	const email =
		result.exitCode === 0 ? normalizeEmail(result.stdout ?? '') : '';
	const resolved = email.length > 0 ? email : null;

	emailByRepo.set(cwd, {email: resolved, readAt: Date.now()});
	return resolved;
};

/**
 * The git author name, used only to propose a board name at setup. Never
 * written over one the user already has.
 */
export const readGitName = async (cwd: string): Promise<string | null> => {
	const result = await execGitAllowFail({
		args: ['config', '--get', 'user.name'],
		cwd,
	});

	if (result.exitCode !== 0) return null;

	const name = (result.stdout ?? '').trim();
	return name.length > 0 ? name : null;
};
