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
const emailByRepo = new Map<string, string | null>();

/**
 * Cleared when a test, or a process that outlives a config change, needs the
 * next read to go to git again.
 */
export const forgetGitEmail = (): void => emailByRepo.clear();

export const readGitEmail = async (cwd: string): Promise<string | null> => {
	// Cached per repository. `boot()` runs on every MCP call and every socket
	// message, above the fast path that exists to avoid redundant work, so an
	// uncached read here would spawn a git process per request to answer the
	// same thing every time.
	const cached = emailByRepo.get(cwd);
	if (cached !== undefined) return cached;

	const result = await execGitAllowFail({
		args: ['config', '--get', 'user.email'],
		cwd,
	});

	const email =
		result.exitCode === 0 ? normalizeEmail(result.stdout ?? '') : '';
	const resolved = email.length > 0 ? email : null;

	emailByRepo.set(cwd, resolved);
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
