import {execGit} from './git-utils.js';

export const git = {
	stage: ({cwd, pathspec}: {cwd: string; pathspec: string}) =>
		execGit({args: ['add', pathspec], cwd}),

	commit: ({
		cwd,
		message,
		allowEmpty = false,
	}: {
		cwd: string;
		message: string;
		allowEmpty?: boolean;
	}) =>
		execGit({
			args: ['commit', ...(allowEmpty ? ['--allow-empty'] : []), '-m', message],
			cwd,
		}),

	fetch: ({
		cwd,
		remote,
		branch,
	}: {
		cwd: string;
		remote: string;
		branch: string;
	}) => execGit({args: ['fetch', remote, branch], cwd}),

	pullRebase: ({
		cwd,
		remote,
		branch,
	}: {
		cwd: string;
		remote: string;
		branch: string;
	}) => execGit({args: ['pull', '--rebase', remote, branch], cwd}),

	checkout: ({cwd, branch}: {cwd: string; branch: string}) =>
		execGit({args: ['checkout', branch], cwd}),

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
				? ['push', ...(setUpstream ? ['-u'] : []), remote, branch]
				: ['push'];

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
