import fs from 'node:fs';
import path from 'node:path';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {logger} from '../logger.js';
import {git} from './git-commands.js';
import {ORIGIN, STATE_BRANCH} from './git-constants.js';
import {
	EMPTY_TREE_SHA,
	ensureDir,
	ensureStateBranchIsStorageOnly,
	ensureWorktreesDir,
	getRelativeEventFilePath,
	removePath,
} from './git-storage.js';
import {
	commitAndGetSha,
	execGit,
	execGitAllowFail,
	getCurrentBranch,
	getShortHeadSha,
	hasLocalBranch,
	hasRemote,
	hasRemoteBranch,
	hasUpstream,
	hasWorktree,
} from './git-utils.js';

export const ensureLocalEventsIgnored = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const gitignorePath = path.join(repoRoot, '.gitignore');
	let content = fs.existsSync(gitignorePath)
		? fs.readFileSync(gitignorePath, 'utf8')
		: '';

	const ignorePattern = '.epiq';
	const lines = content.split('\n');

	// More tolerant check that survives comments, extra spaces, trailing slashes
	const alreadyIgnored = lines.some(line => {
		const trimmed = line.trim();
		return trimmed === ignorePattern || trimmed === ignorePattern + '/';
	});

	if (alreadyIgnored) {
		return succeeded(`${ignorePattern} already ignored`, false);
	}

	const markerComment = `# [epiq]: hydrated state is never to be committed`;
	content = content.trimEnd() + `\n\n${markerComment}\n${ignorePattern}\n`;

	fs.writeFileSync(gitignorePath, content + '\n', 'utf8');

	logger.info(`Added ${ignorePattern} to .gitignore (epiq local cache)`);
	return succeeded(`${ignorePattern} ignored`, true);
};

export const ensureInitialCommit = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const headResult = await execGitAllowFail({
		args: ['rev-parse', '--verify', 'HEAD'],
		cwd: repoRoot,
	});

	if (headResult.exitCode === 0) {
		return succeeded('Initial commit already exists', false);
	}
	logger.info('Creating initial commit');

	const commitResult = await git.commit({
		cwd: repoRoot,
		message: 'Initial commit',
		allowEmpty: true,
	});

	if (isFail(commitResult)) return failed(commitResult.message);

	return succeeded('Created initial commit', true);
};

const sanitizeRefSegment = (value: string): string =>
	value
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^A-Za-z0-9._/-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-/.]+|[-/.]+$/g, '') || 'unknown';

const buildSyncCommitMessage = async (
	repoRoot: string,
): Promise<Result<string>> => {
	const branchResult = await getCurrentBranch(repoRoot);
	if (isFail(branchResult)) return failed(branchResult.message);

	const shaResult = await getShortHeadSha(repoRoot);
	if (isFail(shaResult)) return failed(shaResult.message);

	const message = `[epiq:sync:${sanitizeRefSegment(
		branchResult.value,
	)}:${sanitizeRefSegment(shaResult.value)}]`;

	return succeeded('Built sync commit message', message);
};

const createStateBranch = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	logger.info(`Creating ${STATE_BRANCH}`);

	const commitResult = await execGit({
		args: ['commit-tree', EMPTY_TREE_SHA, '-m', '[epiq:init-state-branch]'],
		cwd: repoRoot,
	});

	if (isFail(commitResult)) {
		return failed(
			`Failed to create state branch commit\n${commitResult.message}`,
		);
	}

	const commitSha = commitResult.value.stdout.trim();

	const updateRefResult = await execGit({
		args: ['update-ref', `refs/heads/${STATE_BRANCH}`, commitSha],
		cwd: repoRoot,
	});

	if (isFail(updateRefResult)) {
		return failed(
			`Failed to create ${STATE_BRANCH}\n${updateRefResult.message}`,
		);
	}

	return succeeded('Created state branch', true);
};

const ensureLocalStateBranch = async ({
	repoRoot,
}: {
	repoRoot: string;
}): Promise<Result<boolean>> => {
	const localResult = await hasLocalBranch({
		repoRoot,
		branch: STATE_BRANCH,
	});
	if (isFail(localResult)) {
		return failed('Ensure local state branch failed\n' + localResult.message);
	}

	if (localResult.value) {
		return succeeded('Local state branch already exists', false);
	}

	const remoteResult = await hasRemote({repoRoot});
	if (isFail(remoteResult)) {
		return failed('Ensure local state branch failed\n' + remoteResult.message);
	}

	if (!remoteResult.value) {
		return createStateBranch(repoRoot);
	}

	const remoteBranchResult = await hasRemoteBranch({
		repoRoot,
		branch: STATE_BRANCH,
	});
	if (isFail(remoteBranchResult)) {
		return failed(
			'Ensure local state branch failed\n' + remoteBranchResult.message,
		);
	}

	if (!remoteBranchResult.value) {
		return createStateBranch(repoRoot);
	}

	const fetchResult = await git.fetch({
		cwd: repoRoot,
		remote: ORIGIN,
		branch: STATE_BRANCH,
	});
	if (isFail(fetchResult)) {
		return failed(
			`Failed to fetch ${STATE_BRANCH} from remote\n${fetchResult.message}`,
		);
	}

	const createFromRemoteResult = await execGit({
		args: ['branch', '--track', STATE_BRANCH, `${ORIGIN}/${STATE_BRANCH}`],
		cwd: repoRoot,
	});
	if (isFail(createFromRemoteResult)) {
		return failed(
			`Failed to create local ${STATE_BRANCH} from remote\n${createFromRemoteResult.message}`,
		);
	}

	return succeeded('Created local state branch from remote', true);
};

const getWorktreeRootForBranch = async ({
	repoRoot,
	branch,
}: {
	repoRoot: string;
	branch: string;
}): Promise<Result<string | null>> => {
	const result = await execGit({
		args: ['worktree', 'list', '--porcelain'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	const lines = result.value.stdout.split('\n');
	let currentWorktree: string | null = null;

	for (const line of lines) {
		if (line.startsWith('worktree ')) {
			currentWorktree = line.slice('worktree '.length);
			continue;
		}

		if (line === `branch refs/heads/${branch}` && currentWorktree) {
			return succeeded('Found worktree for branch', currentWorktree);
		}
	}

	return succeeded('No worktree found for branch', null);
};

const createStateBranchWorktree = async ({
	repoRoot,
	stateBranchRoot,
}: {
	repoRoot: string;
	stateBranchRoot: string;
}): Promise<Result<boolean>> => {
	const ensureRoot = ensureDir(path.dirname(stateBranchRoot));
	if (isFail(ensureRoot)) {
		return failed(
			'Failed to create state branch worktree\n' + ensureRoot.message,
		);
	}

	if (
		fs.existsSync(stateBranchRoot) &&
		!fs.existsSync(path.join(stateBranchRoot, '.git'))
	) {
		logger.info('Removing broken state branch worktree path');
		removePath(stateBranchRoot);
	}

	logger.info('Creating state branch worktree');

	const result = await git.worktreeAdd({
		cwd: repoRoot,
		worktreeRoot: stateBranchRoot,
		branch: STATE_BRANCH,
	});

	if (isFail(result)) {
		return failed(`Failed to create state branch worktree\n${result.message}`);
	}

	return succeeded('Created state branch worktree', true);
};

const ensureStateBranchWorktree = async ({
	repoRoot,
	stateBranchRoot,
}: {
	repoRoot: string;
	stateBranchRoot: string;
}): Promise<Result<boolean>> => {
	const existingResult = await getWorktreeRootForBranch({
		repoRoot,
		branch: STATE_BRANCH,
	});
	if (isFail(existingResult)) return failed(existingResult.message);

	const expected = path.resolve(stateBranchRoot);
	const existing = existingResult.value
		? path.resolve(existingResult.value)
		: null;

	if (existing && existing === expected && fs.existsSync(existing)) {
		return succeeded(
			'State branch already checked out in expected worktree',
			false,
		);
	}

	if (existing && existing !== expected) {
		logger.info('Moving state branch worktree to expected location');

		const removeResult = await git.worktreeRemove({
			cwd: repoRoot,
			worktreeRoot: existing,
		});

		if (isFail(removeResult)) {
			return failed(
				`Failed to remove existing state branch worktree\n${removeResult.message}`,
			);
		}
	}

	if (existing && !fs.existsSync(existing)) {
		logger.info('Pruning stale state branch worktree');

		const pruneResult = await git.worktreePrune({cwd: repoRoot});

		if (isFail(pruneResult)) {
			return failed(`Failed to prune stale worktrees\n${pruneResult.message}`);
		}
	}

	const registeredResult = await hasWorktree({
		repoRoot,
		worktreeRoot: stateBranchRoot,
	});
	if (isFail(registeredResult)) return failed(registeredResult.message);

	const existsOnDisk = fs.existsSync(stateBranchRoot);

	if (registeredResult.value && existsOnDisk) {
		return succeeded('State branch worktree already exists', false);
	}

	if (registeredResult.value && !existsOnDisk) {
		logger.info('Pruning missing registered state branch worktree');

		const pruneResult = await git.worktreePrune({cwd: repoRoot});

		if (isFail(pruneResult)) {
			return failed(`Failed to prune stale worktrees\n${pruneResult.message}`);
		}
	}

	return createStateBranchWorktree({repoRoot, stateBranchRoot});
};

/**
 * Ensure we are ate state branch head
 */
const ensureStateBranchCheckedOut = async (
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const currentBranchResult = await getCurrentBranch(stateBranchRoot);
	if (isFail(currentBranchResult)) return failed(currentBranchResult.message);

	if (currentBranchResult.value === STATE_BRANCH) {
		return succeeded('State branch already checked out', false);
	}

	const checkoutResult = await git.checkout({
		cwd: stateBranchRoot,
		branch: STATE_BRANCH,
	});

	if (isFail(checkoutResult)) {
		return failed(
			`Failed to checkout ${STATE_BRANCH}\n${checkoutResult.message}`,
		);
	}

	return succeeded('Checked out state branch', true);
};

const ensureStateBranchTracksRemote = async (
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(stateBranchRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);

	if (upstreamResult.value) {
		return succeeded('State branch upstream already configured', false);
	}

	const remoteResult = await hasRemote({
		repoRoot: stateBranchRoot,
	});
	if (isFail(remoteResult)) return failed(remoteResult.message);

	if (!remoteResult.value) {
		return succeeded('No remote available for state branch upstream', false);
	}

	const remoteBranchResult = await hasRemoteBranch({
		repoRoot: stateBranchRoot,
		branch: STATE_BRANCH,
	});
	if (isFail(remoteBranchResult)) return failed(remoteBranchResult.message);

	if (!remoteBranchResult.value) {
		return succeeded(
			'Remote state branch missing; upstream will be configured on first push',
			false,
		);
	}

	logger.info(`Configuring ${STATE_BRANCH} upstream`);

	const fetchResult = await git.fetch({
		cwd: stateBranchRoot,
		remote: ORIGIN,
		branch: STATE_BRANCH,
	});
	if (isFail(fetchResult)) {
		return failed(`Failed to fetch ${STATE_BRANCH}\n${fetchResult.message}`);
	}

	const setUpstreamResult = await git.setUpstream({
		cwd: stateBranchRoot,
		branch: STATE_BRANCH,
		upstream: `${ORIGIN}/${STATE_BRANCH}`,
	});

	if (isFail(setUpstreamResult)) {
		return failed(
			`Failed to set state branch upstream\n${setUpstreamResult.message}`,
		);
	}

	return succeeded('Configured state branch upstream', true);
};

export const stageStateBranchOwnEventFile = async ({
	stateBranchRoot,
	ownEventFileName,
}: {
	stateBranchRoot: string;
	ownEventFileName: string;
}): Promise<Result<void>> => {
	const stageResult = await git.stage({
		cwd: stateBranchRoot,
		pathspec: getRelativeEventFilePath(ownEventFileName),
	});

	if (isFail(stageResult)) {
		return failed(
			`Failed to stage state branch own event file\n${stageResult.message}`,
		);
	}

	return succeeded('Staged state branch own event file', undefined);
};

export const createStateBranchSyncCommit = async ({
	repoRoot,
	stateBranchRoot,
}: {
	repoRoot: string;
	stateBranchRoot: string;
}): Promise<Result<string>> => {
	const messageResult = await buildSyncCommitMessage(repoRoot);
	if (isFail(messageResult)) {
		return failed(
			'Create state branch sync commit failed\n' + messageResult.message,
		);
	}

	return commitAndGetSha({
		cwd: stateBranchRoot,
		message: messageResult.value,
	});
};

export const pushStateBranch = async (
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(stateBranchRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);

	const result = upstreamResult.value
		? await git.push({cwd: stateBranchRoot})
		: await git.push({
				cwd: stateBranchRoot,
				remote: ORIGIN,
				branch: STATE_BRANCH,
				setUpstream: true,
		  });

	if (isFail(result)) {
		return failed(`Failed during state branch push\n${result.message}`);
	}

	return succeeded('Pushed state branch', true);
};

export const bootstrapStateBranchStorage = async ({
	repoRoot,
	stateBranchRoot,
	ensureUpstream,
}: {
	repoRoot: string;
	stateBranchRoot: string;
	ensureUpstream: boolean;
}): Promise<Result<boolean>> => {
	let changed = false;

	const steps = [
		ensureWorktreesDir(),
		await ensureLocalStateBranch({repoRoot}),
		await ensureStateBranchWorktree({
			repoRoot,
			stateBranchRoot,
		}),
		await ensureStateBranchCheckedOut(stateBranchRoot), // Mostly redundant, but protects against manual mess ups on the worktree
		await ensureStateBranchIsStorageOnly(stateBranchRoot),
		ensureUpstream
			? await ensureStateBranchTracksRemote(stateBranchRoot)
			: succeeded('Skipped state branch upstream bootstrap', false),
	] as const;

	for (const step of steps) {
		if (isFail(step)) return failed(step.message);
		changed = changed || Boolean(step.value);
	}

	return succeeded(
		ensureUpstream
			? 'Bootstrapped state storage'
			: 'Bootstrapped state storage (readonly)',
		changed,
	);
};
