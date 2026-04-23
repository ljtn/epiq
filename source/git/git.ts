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
import {logger} from '../logger.js';
import {
	commitAndGetSha,
	execGit,
	execGitAllowFail,
	getCurrentBranchName,
	getRepoRoot,
	getShortHeadSha,
	hasInProgressGitOperation,
	hasLocalBranch,
	hasRemote,
	hasRemoteBranch,
	hasUpstream,
	hasWorktree,
	isDetachedHead,
	isNonFastForward,
	pullBranchRebaseIfPresent,
} from './git-utils.js';
import {memoizeResult} from '../lib/utils/memoize.js';
import {fileContentEquals} from '../lib/utils/files.js';

type SyncSummary = {
	repoRoot: string;
	worktreeRoot: string;
	createdCommit: boolean;
	commitSha?: string;
	pulled: boolean;
	pushed: boolean;
	hydrated: boolean;
	bootstrapped: boolean;
};

type SyncArgs = {
	cwd?: string;
	ownEventFileName: string;
};

const EPIQ_DIR = getEpiqDirName();
const EVENTS_SUBDIR = 'events';
const REMOTE_BRANCH = 'epiq-state-5';
const DEFAULT_REMOTE = 'origin';

const getRelativeEventFilePath = (fileName: string): string =>
	path.join(EPIQ_DIR, EVENTS_SUBDIR, fileName);

const getRepoId = (repoRoot: string): string =>
	createHash('sha1').update(repoRoot).digest('hex').slice(0, 12);

const getEpiqHome = (): string => path.join(os.homedir(), '.epiq');
const getWorktreesRoot = (): string => path.join(getEpiqHome(), 'worktrees');
const getRemoteWorktreeRoot = (repoRoot: string): string =>
	path.join(getWorktreesRoot(), getRepoId(repoRoot));

const getEpiqRoot = (root: string): string => path.join(root, EPIQ_DIR);
const getEventsDir = (root: string): string =>
	path.join(getEpiqRoot(root), EVENTS_SUBDIR);
const getEventFilePath = ({
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

	logger.debug('[sync] listed event files', {eventsDir, count: files.length});
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

		const remoteResult = await hasRemote({repoRoot, remote: DEFAULT_REMOTE});
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

const ensureInitialCommit = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	logger.debug('[sync] ensure initial commit');
	const headResult = await hasHeadCommit(repoRoot);
	if (isFail(headResult)) return failed(headResult.message);
	if (headResult.data) {
		logger.debug('[sync] local HEAD exists');
		return succeeded('Repo already initialized', false);
	}

	const remoteHistoryResult = await remoteHasAnyHistory(repoRoot);
	if (isFail(remoteHistoryResult)) return failed(remoteHistoryResult.message);
	if (remoteHistoryResult.data) {
		logger.debug('[sync] skip local init commit due to remote history');
		return succeeded(
			'Skipped local init commit because remote history exists',
			false,
		);
	}

	logger.debug('[sync] create empty init commit');
	const commitResult = await execGit({
		args: ['commit', '--allow-empty', '-m', '[epiq:init]'],
		cwd: repoRoot,
	});

	if (isFail(commitResult)) {
		return failed(`Failed to create initial commit\n${commitResult.message}`);
	}

	return succeeded('Created initial commit', true);
};

const copyOwnEventFileToRemote = ({
	repoRoot,
	worktreeRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ownEventFileName: string;
}): Result<boolean> => {
	const localFile = getEventFilePath({
		root: repoRoot,
		fileName: ownEventFileName,
	});
	const remoteFile = getEventFilePath({
		root: worktreeRoot,
		fileName: ownEventFileName,
	});

	if (!fs.existsSync(localFile)) {
		logger.debug('[sync] local own event file missing', localFile);
		return succeeded('Local own event file missing, nothing to copy', false);
	}

	if (fileContentEquals(localFile, remoteFile)) {
		logger.debug(
			'[sync] own event file already matches remote',
			ownEventFileName,
		);
		return succeeded('Own event file already matches remote worktree', false);
	}

	logger.debug('[sync] copy own event file to remote', ownEventFileName);
	fs.mkdirSync(path.dirname(remoteFile), {recursive: true});
	fs.copyFileSync(localFile, remoteFile);

	return succeeded('Copied own event file into remote worktree', true);
};

const hydrateEventsFromRemote = ({
	repoRoot,
	worktreeRoot,
	skipFileNames = [],
}: {
	repoRoot: string;
	worktreeRoot: string;
	skipFileNames?: string[];
}): Result<boolean> => {
	const remoteFilesResult = listEventFiles(worktreeRoot);
	if (isFail(remoteFilesResult)) return failed(remoteFilesResult.message);

	const remoteEventsDir = getEventsDir(worktreeRoot);
	const localEventsDir = getEventsDir(repoRoot);
	const skip = new Set(skipFileNames);

	let changed = false;

	for (const fileName of remoteFilesResult.data) {
		if (skip.has(fileName)) {
			logger.debug('[sync] skip hydrate for file', fileName);
			continue;
		}

		const from = path.join(remoteEventsDir, fileName);
		const to = path.join(localEventsDir, fileName);

		if (fileContentEquals(from, to)) continue;

		logger.debug('[sync] hydrate remote file', fileName);
		fs.mkdirSync(path.dirname(to), {recursive: true});
		fs.copyFileSync(from, to);
		changed = true;
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

const ensureLocalRemoteBranch = async ({
	repoRoot,
}: {
	repoRoot: string;
}): Promise<Result<boolean>> => {
	logger.debug('[sync] ensure local remote branch', REMOTE_BRANCH);

	const localResult = await hasLocalBranch({repoRoot, branch: REMOTE_BRANCH});
	if (isFail(localResult)) return failed(localResult.message);
	if (localResult.data) {
		logger.debug('[sync] local remote branch exists');
		return succeeded('Local remote branch already exists', false);
	}

	const remoteResult = await hasRemote({repoRoot, remote: DEFAULT_REMOTE});
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

	logger.debug('[sync] create local remote branch from HEAD', REMOTE_BRANCH);
	const createLocal = await execGit({
		args: ['branch', REMOTE_BRANCH, 'HEAD'],
		cwd: repoRoot,
	});
	if (isFail(createLocal)) {
		return failed(
			`Failed to create local ${REMOTE_BRANCH}\n${createLocal.message}`,
		);
	}

	return succeeded('Created local remote branch', true);
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

		const registeredAfterPrune = await hasWorktree({repoRoot, worktreeRoot});
		if (isFail(registeredAfterPrune))
			return failed(registeredAfterPrune.message);

		if (registeredAfterPrune.data) {
			logger.debug('[sync] remove stale remote worktree registration');
			const removeResult = await execGit({
				args: ['worktree', 'remove', '--force', worktreeRoot],
				cwd: repoRoot,
			});
			if (isFail(removeResult)) {
				return failed(
					`Failed to remove stale worktree registration\n${removeResult.message}`,
				);
			}
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

	if (remoteBranchResult.data) {
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
	}

	logger.debug('[sync] publish remote branch and set upstream');
	const pushResult = await execGit({
		args: ['push', '-u', DEFAULT_REMOTE, REMOTE_BRANCH],
		cwd: worktreeRoot,
	});
	if (isFail(pushResult)) {
		return failed(`Failed to publish remote branch\n${pushResult.message}`);
	}

	return succeeded('Published remote branch and configured upstream', true);
};

const stageRemoteOwnEventFile = async ({
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

const createRemoteSyncCommit = async ({
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

const pushRemote = async (worktreeRoot: string): Promise<Result<boolean>> => {
	logger.debug('[sync] push remote worktree');

	const result = await execGit({
		args: ['push'],
		cwd: worktreeRoot,
	});
	if (isFail(result)) {
		return failed(`Failed during remote push\n${result.message}`);
	}

	return succeeded('Pushed remote', true);
};

const bootstrapRemoteStorageBase = async ({
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

	for (const step of [
		ensureEpiqStorage(),
		await ensureLocalRemoteBranch({repoRoot}),
		await ensureRemoteWorktree({repoRoot, worktreeRoot}),
		await ensureRemoteBranchCheckedOut(worktreeRoot),
		ensureUpstream
			? await ensureRemoteUpstream(worktreeRoot)
			: succeeded('Skipped remote upstream bootstrap', false),
	] as Result[]) {
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

const ensureRemoteLayout = (
	repoRoot: string,
	worktreeRoot: string,
): Result<void> => {
	for (const dir of [getEventsDir(repoRoot), getEventsDir(worktreeRoot)]) {
		const result = ensureDir(dir);
		if (isFail(result)) return failed(result.message);
	}
	return succeeded('Ensured remote layout', undefined);
};

type SyncOwnFileCommitResult = {
	createdCommit: boolean;
	commitSha?: string;
};

const syncOwnFileToRemoteCommit = async ({
	repoRoot,
	worktreeRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ownEventFileName: string;
}): Promise<Result<SyncOwnFileCommitResult>> => {
	const copyResult = copyOwnEventFileToRemote({
		repoRoot,
		worktreeRoot,
		ownEventFileName,
	});
	if (isFail(copyResult)) return failed(copyResult.message);

	if (!copyResult.data) {
		return succeeded('Own event file already up to date in remote worktree', {
			createdCommit: false,
		});
	}

	const stageResult = await stageRemoteOwnEventFile({
		worktreeRoot,
		ownEventFileName,
	});
	if (isFail(stageResult)) return failed(stageResult.message);

	const commitResult = await createRemoteSyncCommit({
		repoRoot,
		worktreeRoot,
	});
	if (isFail(commitResult)) return failed(commitResult.message);

	return succeeded('Copied, staged, and committed own event file', {
		createdCommit: true,
		commitSha: commitResult.data,
	});
};

export const syncEpiqWithRemote = async ({
	cwd = process.cwd(),
	ownEventFileName,
}: SyncArgs): Promise<Result<SyncSummary>> => {
	logger.debug('[sync] start write sync', {cwd, ownEventFileName});

	const repoRootResult = await getRepoRoot(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.data;
	const worktreeRoot = getRemoteWorktreeRoot(repoRoot);
	logger.debug('[sync] resolved roots', {repoRoot, worktreeRoot});

	const detachedResult = await isDetachedHead(repoRoot);
	if (isFail(detachedResult)) return failed(detachedResult.message);
	if (detachedResult.data) {
		return failed(
			'Cannot run :sync while the repository is in detached HEAD state',
		);
	}

	if (ownEventFileName.includes('/') || ownEventFileName.includes('\\')) {
		return failed('Own event file must be a file name, not a path');
	}
	if (!ownEventFileName.endsWith('.jsonl')) {
		return failed('Own event file must end with .jsonl');
	}

	const repoOpResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(repoOpResult)) return failed(repoOpResult.message);
	if (repoOpResult.data) {
		return failed(
			'Cannot run :sync while a merge, rebase, cherry-pick, or revert is in progress in the current repo',
		);
	}

	const initResult = await ensureInitialCommit(repoRoot);
	if (isFail(initResult)) return failed(initResult.message);
	logger.debug('[sync] ensure initial commit changed', initResult.data);

	const bootstrapResult = await bootstrapRemoteStorageBase({
		repoRoot,
		worktreeRoot,
		ensureUpstream: true,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const remoteOpResult = await hasInProgressGitOperation(worktreeRoot);
	if (isFail(remoteOpResult)) return failed(remoteOpResult.message);
	if (remoteOpResult.data) {
		return failed(
			'Cannot run :sync while a merge, rebase, cherry-pick, or revert is in progress in the remote worktree',
		);
	}

	const layoutResult = ensureRemoteLayout(repoRoot, worktreeRoot);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	let createdCommit = false;
	let commitSha: string | undefined;
	let pulled = false;
	let pushed = false;
	let hydrated = false;

	logger.debug('[sync] pull remote branch before local copy');
	const pullResult = await pullBranchRebaseIfPresent({
		cwd: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: REMOTE_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);
	pulled = pullResult.data;
	logger.debug('[sync] pulled remote', pulled);

	const hydrateResult = hydrateEventsFromRemote({
		repoRoot,
		worktreeRoot,
		skipFileNames: [ownEventFileName],
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);
	hydrated = hydrateResult.data;
	logger.debug('[sync] hydrated from remote', hydrated);

	const syncOwnResult = await syncOwnFileToRemoteCommit({
		repoRoot,
		worktreeRoot,
		ownEventFileName,
	});
	if (isFail(syncOwnResult)) return failed(syncOwnResult.message);

	createdCommit = syncOwnResult.data.createdCommit;
	commitSha = syncOwnResult.data.commitSha;
	logger.debug('[sync] sync own file result', syncOwnResult.data);

	const pushResult = await pushRemote(worktreeRoot);
	let finalPushResult = pushResult;

	if (isFail(pushResult) && isNonFastForward(pushResult.message)) {
		const pullRetryResult = await pullBranchRebaseIfPresent({
			cwd: worktreeRoot,
			remote: DEFAULT_REMOTE,
			branch: REMOTE_BRANCH,
		});
		if (isFail(pullRetryResult)) return failed(pullRetryResult.message);

		const retrySyncOwnResult = await syncOwnFileToRemoteCommit({
			repoRoot,
			worktreeRoot,
			ownEventFileName,
		});
		if (isFail(retrySyncOwnResult)) return failed(retrySyncOwnResult.message);

		if (retrySyncOwnResult.data.createdCommit) {
			createdCommit = true;
			commitSha = retrySyncOwnResult.data.commitSha;
		}
		logger.debug('[sync] retry sync own file result', retrySyncOwnResult.data);

		finalPushResult = await pushRemote(worktreeRoot);
		if (isFail(finalPushResult)) return failed(finalPushResult.message);
	}

	if (isFail(finalPushResult)) return failed(finalPushResult.message);
	pushed = finalPushResult.data;
	logger.debug('[sync] pushed remote', pushed);

	if (createdCommit) {
		const finalShaResult = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: worktreeRoot,
		});
		if (isFail(finalShaResult)) return failed(finalShaResult.message);

		commitSha = finalShaResult.data.stdout.trim();
	}

	return succeeded('Synced event logs with remote', {
		repoRoot,
		worktreeRoot,
		createdCommit,
		commitSha,
		pulled,
		pushed,
		hydrated,
		bootstrapped: bootstrapResult.data,
	});
};

export const syncEpiqFromRemote = async (
	cwd = process.cwd(),
): Promise<Result<{repoRoot: string; worktreeRoot: string}>> => {
	logger.debug('[sync] start readonly sync', {cwd});

	const repoRootResult = await getRepoRoot(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.data;
	const worktreeRoot = getRemoteWorktreeRoot(repoRoot);
	logger.debug('[sync] resolved readonly roots', {repoRoot, worktreeRoot});

	const repoOpResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(repoOpResult)) return failed(repoOpResult.message);
	if (repoOpResult.data) {
		return failed(
			'Cannot sync while a git operation is in progress in the current repo',
		);
	}

	const ensureInitialCommitResult = await ensureInitialCommit(repoRoot);
	if (isFail(ensureInitialCommitResult))
		return failed(ensureInitialCommitResult.message);
	logger.debug(
		'[sync] readonly ensure initial commit changed',
		ensureInitialCommitResult.data,
	);

	const bootstrapResult = await bootstrapRemoteStorageBase({
		repoRoot,
		worktreeRoot,
		ensureUpstream: false,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const remoteOpResult = await hasInProgressGitOperation(worktreeRoot);
	if (isFail(remoteOpResult)) return failed(remoteOpResult.message);
	if (remoteOpResult.data) {
		return failed(
			'Cannot sync while a git operation is in progress in the remote worktree',
		);
	}

	const layoutResult = ensureRemoteLayout(repoRoot, worktreeRoot);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	logger.debug('[sync] readonly pull remote branch');
	const pullResult = await pullBranchRebaseIfPresent({
		cwd: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: REMOTE_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);
	logger.debug('[sync] readonly pulled remote', pullResult.data);

	const hydrateResult = hydrateEventsFromRemote({
		repoRoot,
		worktreeRoot,
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);
	logger.debug('[sync] readonly hydrated from remote', hydrateResult.data);

	return succeeded('Synced from remote', {
		repoRoot,
		worktreeRoot,
	});
};
