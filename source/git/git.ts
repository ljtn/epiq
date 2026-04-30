import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getEpiqDirName} from '../init.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../lib/command-line/command-types.js';
import {memoizeResult} from '../lib/utils/memoize.js';
import {logger} from '../logger.js';
import {
	commitAndGetSha,
	execGit,
	execGitAllowFail,
	getCurrentBranchName,
	getShortHeadSha,
	hasLocalBranch,
	hasRemote,
	hasRemoteBranch,
	hasUpstream,
	hasWorktree,
} from './git-utils.js';
import {mergeEventFile} from './merge.js';

export const REMOTE_BRANCH = 'epiq/events';
export const DEFAULT_REMOTE = 'origin';

const EPIQ_DIR = getEpiqDirName();
const EVENTS_SUBDIR = 'events';
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const getRelativeEventFilePath = (fileName: string): string =>
	path.join(EPIQ_DIR, EVENTS_SUBDIR, fileName);

const getRepoId = (repoRoot: string): string =>
	createHash('sha1').update(path.resolve(repoRoot)).digest('hex').slice(0, 12);

const getEpiqHome = (): string => path.join(os.homedir(), '.epiq');
const getWorktreesRoot = (): string => path.join(getEpiqHome(), 'worktrees');

export const getRemoteWorktreeRoot = (repoRoot: string): string =>
	path.join(getWorktreesRoot(), getRepoId(repoRoot));

const getEpiqRoot = (root: string): string => path.join(root, EPIQ_DIR);

const getEventsDir = (root: string): string =>
	path.join(getEpiqRoot(root), EVENTS_SUBDIR);

export const getEventFilePath = ({
	root,
	fileName,
}: {
	root: string;
	fileName: string;
}): string => path.join(getEventsDir(root), fileName);

const ensureDir = (dirPath: string): Result<void> => {
	logger.debug('[sync] ensure dir', dirPath);
	fs.mkdirSync(dirPath, {recursive: true});
	return succeeded('Ensured directory', undefined);
};

const ensureEpiqStorage = (): Result<void> => {
	logger.debug('[sync] ensure epiq storage');

	const homeResult = ensureDir(getEpiqHome());
	if (isFail(homeResult)) return failed(homeResult.message);

	const worktreesResult = ensureDir(getWorktreesRoot());
	if (isFail(worktreesResult)) return failed(worktreesResult.message);

	return succeeded('Ensured epiq storage', undefined);
};

const removePath = (targetPath: string): void => {
	if (!fs.existsSync(targetPath)) return;

	logger.debug('[sync] remove path', targetPath);
	fs.rmSync(targetPath, {recursive: true, force: true});
};

const listEventFiles = (root: string): Result<string[]> => {
	const eventsDir = getEventsDir(root);

	if (!fs.existsSync(eventsDir)) {
		logger.debug('[sync] events dir missing', eventsDir);
		return succeeded('Events dir missing', []);
	}

	const files = fs
		.readdirSync(eventsDir, {withFileTypes: true})
		.filter(entry => entry.isFile())
		.map(entry => entry.name)
		.filter(name => name.endsWith('.jsonl'))
		.sort();

	logger.debug('[sync] listed event files', {
		eventsDir,
		count: files.length,
	});

	return succeeded('Listed event files', files);
};

const hasHeadCommit = async (repoRoot: string): Promise<Result<boolean>> => {
	logger.debug('[sync] inspect local HEAD', repoRoot);

	const result = await execGitAllowFail({
		args: ['rev-parse', '--verify', 'HEAD'],
		cwd: repoRoot,
	});

	if (result.exitCode === 0) return succeeded('Repo has HEAD', true);
	if (result.exitCode === 1) return succeeded('Repo has no HEAD', false);

	return failed(result.stderr.trim() || 'Unable to inspect HEAD');
};

const remoteHasAnyHistory = memoizeResult(
	async (repoRoot: string): Promise<Result<boolean>> => {
		logger.debug('[sync] inspect remote history', {
			repoRoot,
			remote: DEFAULT_REMOTE,
		});

		const remoteResult = await hasRemote({
			repoRoot,
			remote: DEFAULT_REMOTE,
		});
		if (isFail(remoteResult)) return failed(remoteResult.message);
		if (!remoteResult.data) return succeeded('No remote configured', false);

		const result = await execGitAllowFail({
			args: ['ls-remote', '--heads', DEFAULT_REMOTE],
			cwd: repoRoot,
		});

		if (result.exitCode !== 0) {
			return failed(result.stderr.trim() || 'Unable to inspect remote heads');
		}

		const hasHistory = result.stdout.trim().length > 0;
		logger.debug('[sync] remote history', hasHistory);

		return succeeded('Checked remote history', hasHistory);
	},
	(repoRoot: string) => path.resolve(repoRoot),
);

export const hasAnyCommit = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['rev-parse', '--verify', 'HEAD'],
		cwd: repoRoot,
	});

	if (result.exitCode === 0) {
		return succeeded('Repository has commits', true);
	}

	return succeeded('Repository has no commits', false);
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

	const commitResult = await execGit({
		args: ['commit', '--allow-empty', '-m', 'Initial commit'],
		cwd: repoRoot,
	});

	if (isFail(commitResult)) {
		return failed(commitResult.message);
	}

	return succeeded('Created initial commit', true);
};

export const hydrateEventsFromRemote = ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Result<boolean> => {
	const remoteFilesResult = listEventFiles(worktreeRoot);
	if (isFail(remoteFilesResult)) return failed(remoteFilesResult.message);

	const remoteEventsDir = getEventsDir(worktreeRoot);
	const localEventsDir = getEventsDir(repoRoot);

	let changed = false;

	for (const fileName of remoteFilesResult.data) {
		const from = path.join(remoteEventsDir, fileName);
		const to = path.join(localEventsDir, fileName);

		logger.debug('[sync] hydrate event file', {from, to});

		const mergeResult = mergeEventFile({
			sourceFile: from,
			targetFile: to,
		});

		if (isFail(mergeResult)) return failed(mergeResult.message);

		changed = changed || mergeResult.data;
	}

	logger.debug('[sync] hydrate changed', changed);

	return succeeded('Hydrated event files from remote worktree', changed);
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
	const branchResult = await getCurrentBranchName(repoRoot);
	if (isFail(branchResult)) return failed(branchResult.message);

	const shaResult = await getShortHeadSha(repoRoot);
	if (isFail(shaResult)) return failed(shaResult.message);

	const message = `[epiq:sync:${sanitizeRefSegment(
		branchResult.data,
	)}:${sanitizeRefSegment(shaResult.data)}]`;

	logger.debug('[sync] commit message', message);

	return succeeded('Built sync commit message', message);
};

const createEmptyStorageBranch = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	logger.debug('[sync] create empty storage branch', REMOTE_BRANCH);

	const commitResult = await execGit({
		args: ['commit-tree', EMPTY_TREE_SHA, '-m', '[epiq:init-storage-branch]'],
		cwd: repoRoot,
	});

	if (isFail(commitResult)) {
		return failed(
			`Failed to create storage branch commit\n${commitResult.message}`,
		);
	}

	const commitSha = commitResult.data.stdout.trim();

	const updateRefResult = await execGit({
		args: ['update-ref', `refs/heads/${REMOTE_BRANCH}`, commitSha],
		cwd: repoRoot,
	});

	if (isFail(updateRefResult)) {
		return failed(
			`Failed to create ${REMOTE_BRANCH}\n${updateRefResult.message}`,
		);
	}

	return succeeded('Created empty storage branch', true);
};

const ensureLocalRemoteBranch = async ({
	repoRoot,
}: {
	repoRoot: string;
}): Promise<Result<boolean>> => {
	logger.debug('[sync] ensure local remote branch', REMOTE_BRANCH);

	const localResult = await hasLocalBranch({
		repoRoot,
		branch: REMOTE_BRANCH,
	});
	if (isFail(localResult)) return failed(localResult.message);

	if (localResult.data) {
		logger.debug('[sync] local remote branch exists');
		return succeeded('Local remote branch already exists', false);
	}

	const remoteResult = await hasRemote({
		repoRoot,
		remote: DEFAULT_REMOTE,
	});
	if (isFail(remoteResult)) return failed(remoteResult.message);

	if (remoteResult.data) {
		const remoteBranchResult = await hasRemoteBranch({
			repoRoot,
			remote: DEFAULT_REMOTE,
			branch: REMOTE_BRANCH,
		});
		if (isFail(remoteBranchResult)) return failed(remoteBranchResult.message);

		if (remoteBranchResult.data) {
			logger.debug('[sync] fetch remote branch before local track');

			const fetchResult = await execGit({
				args: ['fetch', DEFAULT_REMOTE, REMOTE_BRANCH],
				cwd: repoRoot,
			});
			if (isFail(fetchResult)) {
				return failed(
					`Failed to fetch ${REMOTE_BRANCH} from remote\n${fetchResult.message}`,
				);
			}

			logger.debug('[sync] create local tracking branch', REMOTE_BRANCH);

			const createFromRemote = await execGit({
				args: [
					'branch',
					'--track',
					REMOTE_BRANCH,
					`${DEFAULT_REMOTE}/${REMOTE_BRANCH}`,
				],
				cwd: repoRoot,
			});
			if (isFail(createFromRemote)) {
				return failed(
					`Failed to create local ${REMOTE_BRANCH} from remote\n${createFromRemote.message}`,
				);
			}

			return succeeded('Created local remote branch from remote', true);
		}
	}

	return createEmptyStorageBranch(repoRoot);
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

	const lines = result.data.stdout.split('\n');
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

const createRemoteWorktree = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	logger.debug('[sync] create remote worktree', worktreeRoot);

	const ensureRoot = ensureDir(path.dirname(worktreeRoot));
	if (isFail(ensureRoot)) return failed(ensureRoot.message);

	if (
		fs.existsSync(worktreeRoot) &&
		!fs.existsSync(path.join(worktreeRoot, '.git'))
	) {
		logger.debug('[sync] remove broken remote worktree path', worktreeRoot);
		removePath(worktreeRoot);
	}

	const result = await execGit({
		args: ['worktree', 'add', worktreeRoot, REMOTE_BRANCH],
		cwd: repoRoot,
	});

	if (isFail(result)) {
		return failed(`Failed to create remote worktree\n${result.message}`);
	}

	return succeeded('Created remote worktree', true);
};

const ensureRemoteWorktree = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	logger.debug('[sync] ensure remote worktree', worktreeRoot);

	const existingBranchWorktreeResult = await getWorktreeRootForBranch({
		repoRoot,
		branch: REMOTE_BRANCH,
	});
	if (isFail(existingBranchWorktreeResult)) {
		return failed(existingBranchWorktreeResult.message);
	}

	const existingBranchWorktree = existingBranchWorktreeResult.data;
	const expected = path.resolve(worktreeRoot);
	const existing = existingBranchWorktree
		? path.resolve(existingBranchWorktree)
		: null;

	if (existing && existing === expected && fs.existsSync(existing)) {
		logger.debug('[sync] reuse existing remote branch worktree', {
			expected,
			actual: existing,
		});

		return succeeded(
			'Remote branch already checked out in expected worktree',
			false,
		);
	}

	if (existing && existing !== expected) {
		logger.debug('[sync] remove old remote branch worktree', {
			expected,
			actual: existing,
		});

		const removeResult = await execGit({
			args: ['worktree', 'remove', '--force', existing],
			cwd: repoRoot,
		});

		if (isFail(removeResult)) {
			return failed(
				`Failed to remove existing remote worktree\n${removeResult.message}`,
			);
		}
	}

	if (existing && !fs.existsSync(existing)) {
		logger.debug('[sync] prune stale branch worktree registration', {
			existingBranchWorktree: existing,
		});

		const pruneResult = await execGit({
			args: ['worktree', 'prune'],
			cwd: repoRoot,
		});

		if (isFail(pruneResult)) {
			return failed(`Failed to prune stale worktrees\n${pruneResult.message}`);
		}
	}

	const registeredResult = await hasWorktree({repoRoot, worktreeRoot});
	if (isFail(registeredResult)) return failed(registeredResult.message);

	const existsOnDisk = fs.existsSync(worktreeRoot);

	if (registeredResult.data && existsOnDisk) {
		logger.debug('[sync] remote worktree exists');
		return succeeded('Remote worktree already exists', false);
	}

	if (registeredResult.data && !existsOnDisk) {
		logger.debug('[sync] prune stale remote worktree registration');

		const pruneResult = await execGit({
			args: ['worktree', 'prune'],
			cwd: repoRoot,
		});

		if (isFail(pruneResult)) {
			return failed(`Failed to prune stale worktrees\n${pruneResult.message}`);
		}
	}

	return createRemoteWorktree({repoRoot, worktreeRoot});
};

const ensureRemoteBranchCheckedOut = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const currentBranchResult = await getCurrentBranchName(worktreeRoot);
	if (isFail(currentBranchResult)) return failed(currentBranchResult.message);

	if (currentBranchResult.data === REMOTE_BRANCH) {
		logger.debug('[sync] remote branch already checked out');
		return succeeded('Remote branch already checked out', false);
	}

	logger.debug('[sync] checkout remote branch', REMOTE_BRANCH);

	const checkoutResult = await execGit({
		args: ['checkout', REMOTE_BRANCH],
		cwd: worktreeRoot,
	});

	if (isFail(checkoutResult)) {
		return failed(
			`Failed to checkout ${REMOTE_BRANCH}\n${checkoutResult.message}`,
		);
	}

	return succeeded('Checked out remote branch', true);
};

const ensureRemoteBranchIsStorageOnly = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const result = await execGit({
		args: ['ls-tree', '--name-only', 'HEAD'],
		cwd: worktreeRoot,
	});

	if (isFail(result)) return failed(result.message);

	const topLevelFiles = result.data.stdout.trim().split('\n').filter(Boolean);
	const invalidFiles = topLevelFiles.filter(file => file !== EPIQ_DIR);

	if (invalidFiles.length === 0) {
		return succeeded('Remote branch is storage-only', false);
	}

	logger.debug('[sync] remove app files from storage branch', invalidFiles);

	const removeResult = await execGit({
		args: ['rm', '-r', '--ignore-unmatch', '--', ...invalidFiles],
		cwd: worktreeRoot,
	});

	if (isFail(removeResult)) {
		return failed(`Failed to clean storage branch\n${removeResult.message}`);
	}

	const commitResult = await commitAndGetSha({
		cwd: worktreeRoot,
		message: '[epiq:repair-storage-branch]',
	});

	if (isFail(commitResult)) return failed(commitResult.message);

	return succeeded('Cleaned storage branch', true);
};

const ensureRemoteUpstream = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	logger.debug('[sync] ensure remote upstream', REMOTE_BRANCH);

	const upstreamResult = await hasUpstream(worktreeRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);

	if (upstreamResult.data) {
		logger.debug('[sync] remote upstream already configured');
		return succeeded('Remote upstream already configured', false);
	}

	const remoteResult = await hasRemote({
		repoRoot: worktreeRoot,
		remote: DEFAULT_REMOTE,
	});
	if (isFail(remoteResult)) return failed(remoteResult.message);

	if (!remoteResult.data) {
		logger.debug('[sync] no remote configured for upstream');
		return succeeded('No remote available for upstream', false);
	}

	const remoteBranchResult = await hasRemoteBranch({
		repoRoot: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: REMOTE_BRANCH,
	});
	if (isFail(remoteBranchResult)) return failed(remoteBranchResult.message);

	if (!remoteBranchResult.data) {
		logger.debug(
			'[sync] remote branch missing; upstream will be configured on first push',
		);
		return succeeded('Deferred upstream until first push', false);
	}

	logger.debug('[sync] fetch remote branch before upstream set');

	const fetchResult = await execGit({
		args: ['fetch', DEFAULT_REMOTE, REMOTE_BRANCH],
		cwd: worktreeRoot,
	});
	if (isFail(fetchResult)) {
		return failed(`Failed to fetch ${REMOTE_BRANCH}\n${fetchResult.message}`);
	}

	logger.debug('[sync] set upstream to remote branch');

	const setUpstreamResult = await execGit({
		args: [
			'branch',
			'--set-upstream-to',
			`${DEFAULT_REMOTE}/${REMOTE_BRANCH}`,
			REMOTE_BRANCH,
		],
		cwd: worktreeRoot,
	});

	if (isFail(setUpstreamResult)) {
		return failed(
			`Failed to set remote upstream\n${setUpstreamResult.message}`,
		);
	}

	return succeeded('Configured remote upstream', true);
};

export const stageRemoteOwnEventFile = async ({
	worktreeRoot,
	ownEventFileName,
}: {
	worktreeRoot: string;
	ownEventFileName: string;
}): Promise<Result<void>> => {
	logger.debug(
		'[sync] stage own event file in remote worktree',
		ownEventFileName,
	);

	const result = await execGit({
		args: ['add', getRelativeEventFilePath(ownEventFileName)],
		cwd: worktreeRoot,
	});

	if (isFail(result)) {
		return failed(`Failed to stage remote own event file\n${result.message}`);
	}

	return succeeded('Staged remote own event file', undefined);
};

export const createRemoteSyncCommit = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<string>> => {
	const messageResult = await buildSyncCommitMessage(repoRoot);
	if (isFail(messageResult)) return failed(messageResult.message);

	logger.debug('[sync] create remote sync commit');

	return commitAndGetSha({
		cwd: worktreeRoot,
		message: messageResult.data,
	});
};

export const pushRemote = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	logger.debug('[sync] push remote worktree');

	const upstreamResult = await hasUpstream(worktreeRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);

	const result = await execGit({
		args: upstreamResult.data
			? ['push']
			: ['push', '-u', DEFAULT_REMOTE, REMOTE_BRANCH],
		cwd: worktreeRoot,
	});

	logger.debug('[sync] push result', result);

	if (isFail(result)) {
		return failed(`Failed during remote push\n${result.message}`);
	}

	return succeeded('Pushed remote', true);
};

export const bootstrapRemoteStorageBase = async ({
	repoRoot,
	worktreeRoot,
	ensureUpstream,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ensureUpstream: boolean;
}): Promise<Result<boolean>> => {
	logger.debug('[sync] bootstrap remote storage', {
		repoRoot,
		worktreeRoot,
		ensureUpstream,
	});

	let changed = false;

	const steps: Result[] = [
		ensureEpiqStorage(),
		await ensureLocalRemoteBranch({repoRoot}),
		await ensureRemoteWorktree({repoRoot, worktreeRoot}),
		await ensureRemoteBranchCheckedOut(worktreeRoot),
		await ensureRemoteBranchIsStorageOnly(worktreeRoot),
		ensureUpstream
			? await ensureRemoteUpstream(worktreeRoot)
			: succeeded('Skipped remote upstream bootstrap', false),
	];

	for (const step of steps) {
		if (isFail(step)) return failed(step.message);
		changed = changed || Boolean(step.data);
	}

	logger.debug('[sync] bootstrap changed', changed);

	return succeeded(
		ensureUpstream
			? 'Bootstrapped remote storage'
			: 'Bootstrapped remote storage (readonly)',
		changed,
	);
};

export const ensureRemoteLayout = (
	repoRoot: string,
	worktreeRoot: string,
): Result<void> => {
	for (const dir of [getEventsDir(repoRoot), getEventsDir(worktreeRoot)]) {
		const result = ensureDir(dir);
		if (isFail(result)) return failed(result.message);
	}

	return succeeded('Ensured remote layout', undefined);
};
