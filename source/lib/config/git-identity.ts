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
export const readGitEmail = async (cwd: string): Promise<string | null> => {
	const result = await execGitAllowFail({
		args: ['config', '--get', 'user.email'],
		cwd,
	});

	if (result.exitCode !== 0) return null;

	const email = normalizeEmail(result.stdout ?? '');
	return email.length > 0 ? email : null;
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
