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

	// `pathspec` commits only those paths and ignores the rest of the index.
	// Without it a commit takes whatever the user happened to have staged, which
	// in their own repo means committing work that is not ours to commit.
	//
	// `--no-verify`: every call here is epiq's own bookkeeping — the state
	// branch, or `.epiq/project.json` on init — never the user's application
	// changes, so a repo's pre-commit hook has nothing of ours to check. On the
	// state branch it is actively wrong: that worktree holds only `.epiq/`, no
	// package.json, so a hook built for the user's repo fails outright there.
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

	// Explicit refspec: FETCH_HEAD is shared by every process using this
	// worktree, and a concurrent fetch leaves more than one entry in it. A named
	// remote-tracking ref is not clobbered that way.
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

	// `--no-verify`: same reasoning as `commit` above — this is epiq's own state
	// branch push, and this repo's pre-push hook (lint/build/test/e2e/gui) has
	// no business running against that storage-only worktree. It currently
	// fails there outright, since `npm run` finds no package.json to work with.
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
