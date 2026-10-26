import {execGit} from './git-utils.js';

export const git = {
	// `ignoreRemoval`: stage additions and modifications but not deletions, for
	// paths where a missing file is damage rather than an intent to remove it.
	stage: ({
		cwd,
		pathspec,
		ignoreRemoval = false,
	}: {
		cwd: string;
		pathspec: string[];
		ignoreRemoval?: boolean;
	}) =>
		execGit({
			args: [
				'add',
				...(ignoreRemoval ? ['--ignore-removal'] : []),
				...pathspec,
			],
			cwd,
		}),

	// `pathspec` keeps the user's own staged work out of the commit.
	// `--no-verify`: these are epiq's bookkeeping commits, where the repo's hooks would fail.
	commit: ({
		cwd,
		message,
		allowEmpty = false,
		pathspec,
	}: {
		cwd: string;
		message: string;
		allowEmpty?: boolean;
		pathspec?: string[];
	}) =>
		execGit({
			args: [
				'commit',
				'--no-verify',
				...(allowEmpty ? ['--allow-empty'] : []),
				'-m',
				message,
				...(pathspec?.length ? ['--', ...pathspec] : []),
			],
			cwd,
		}),

	// Explicit refspec: FETCH_HEAD is shared by concurrent fetches, a tracking ref is not.
	fetch: ({
		cwd,
		remote,
		branch,
	}: {
		cwd: string;
		remote: string;
		branch: string;
	}) =>
		execGit({
			args: [
				'fetch',
				remote,
				`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
			],
			cwd,
		}),

	// autoStash: an event appended mid-sync would otherwise abort the rebase.
	rebaseOnto: ({cwd, ref}: {cwd: string; ref: string}) =>
		execGit({
			args: ['-c', 'rebase.autoStash=true', 'rebase', ref],
			cwd,
		}),

	checkout: ({cwd, branch}: {cwd: string; branch: string}) =>
		execGit({args: ['checkout', branch], cwd}),

	// `--no-verify`: as for `commit`, the repo's hooks don't belong on the state branch.
	push: ({
		cwd,
		remote,
		branch,
		setUpstream = false,
	}: {
		cwd: string;
		remote?: string;
		branch?: string;
		setUpstream?: boolean;
	}) => {
		const args =
			remote && branch
				? [
						'push',
						'--no-verify',
						...(setUpstream ? ['-u'] : []),
						remote,
						branch,
				  ]
				: ['push', '--no-verify'];

		return execGit({args, cwd});
	},

	setUpstream: ({
		cwd,
		branch,
		upstream,
	}: {
		cwd: string;
		branch: string;
		upstream: string;
	}) =>
		execGit({
			args: ['branch', '--set-upstream-to', upstream, branch],
			cwd,
		}),

	worktreeAdd: ({
		cwd,
		worktreeRoot,
		branch,
	}: {
		cwd: string;
		worktreeRoot: string;
		branch: string;
	}) =>
		execGit({
			args: ['worktree', 'add', worktreeRoot, branch],
			cwd,
		}),

	worktreeRemove: ({cwd, worktreeRoot}: {cwd: string; worktreeRoot: string}) =>
		execGit({
			args: ['worktree', 'remove', '--force', worktreeRoot],
			cwd,
		}),

	worktreePrune: ({cwd}: {cwd: string}) =>
		execGit({
			args: ['worktree', 'prune'],
			cwd,
		}),
};
