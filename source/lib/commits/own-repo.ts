// The board's own repo, as the repos panel shows it beside the linked ones.
// It is never registered: its commits are read from the checkout itself.

import path from 'node:path';
import {execGitAllowFail} from '../../git/git-utils.js';
import {repoLabelOfUrl} from './commit-repos.js';

export type OwnRepo = {
	/** Its origin's basename, or the folder's when it has no origin. */
	label: string;
	/** The `origin` remote, or null when the checkout has none. */
	url: string | null;
	path: string;
};

export const readOwnRepo = async (repoRoot: string): Promise<OwnRepo> => {
	const origin = await execGitAllowFail({
		cwd: repoRoot,
		args: ['config', '--get', 'remote.origin.url'],
	});
	const url = origin.exitCode === 0 ? origin.stdout.trim() || null : null;

	return {
		label: url ? repoLabelOfUrl(url) : path.basename(repoRoot),
		url,
		path: repoRoot,
	};
};
