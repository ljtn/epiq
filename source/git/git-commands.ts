import {execGit} from './git-utils.js';

export const git = {
	stage: ({cwd, pathspec}: {cwd: string; pathspec: string[]}) =>
		execGit({args: ['add', ...pathspec], cwd}),

	// `pathspec` commits only those paths and ignores the rest of the index.
	// Without it a commit takes whatever the user happened to have staged, which
	// in their own repo means committing work that is not ours to commit.
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
				...(allowEmpty ? ['--allow-empty'] : []),
				'-m',
				message,
				...(pathspec?.length ? ['--', ...pathspec] : []),
			],
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

	// autoStash: an event appended mid-sync would otherwise abort the rebase.
	pullRebase: ({
		cwd,
		remote,
		branch,
	}: {
		cwd: string;
		remote: string;
		branch: string;
	}) =>
		execGit({
			args: ['-c', 'rebase.autoStash=true', 'pull', '--rebase', remote, branch],
			cwd,
		}),

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
