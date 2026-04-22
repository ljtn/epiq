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
import {
	execGit,
	getCurrentBranchName,
	getRepoRoot,
	getShortHeadSha,
	hasInProgressGitOperation,
	hasLocalBranch,
	hasRemote,
	hasRemoteBranch,
	hasStagedChanges,
	hasUpstream,
	hasWorktree,
	ensureInitialCommit,
	pullBranchRebaseIfPresent,
} from './git-utils.js';

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
const BOARD_BRANCH = 'epiq-state-5';
const DEFAULT_REMOTE = 'origin';

const getRelativeEventFilePath = (fileName: string): string =>
	path.join(EPIQ_DIR, EVENTS_SUBDIR, fileName);

const getRepoId = (repoRoot: string): string =>
	createHash('sha1').update(repoRoot).digest('hex').slice(0, 12);

const getEpiqHome = (): string => path.join(os.homedir(), '.epiq');
const getWorktreesRoot = (): string => path.join(getEpiqHome(), 'worktrees');
const getBoardWorktreeRoot = (repoRoot: string): string =>
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
	fs.mkdirSync(dirPath, {recursive: true});
	return succeeded('Ensured directory', undefined);
};

const ensureEpiqStorage = (): Result<void> => {
	const homeResult = ensureDir(getEpiqHome());
	if (isFail(homeResult)) return failed(homeResult.message);

	const worktreesResult = ensureDir(getWorktreesRoot());
	if (isFail(worktreesResult)) return failed(worktreesResult.message);

	return succeeded('Ensured epiq storage', undefined);
};

const ensureEpiqDir = (root: string): Result<boolean> => {
	const epiqPath = getEpiqRoot(root);
	if (fs.existsSync(epiqPath)) {
		return succeeded('Epiq dir already exists', false);
	}

	fs.mkdirSync(epiqPath, {recursive: true});
	return succeeded('Created epiq dir', true);
};

const ensureEventsDir = (root: string): Result<boolean> => {
	const eventsPath = getEventsDir(root);
	if (fs.existsSync(eventsPath)) {
		return succeeded('Events dir already exists', false);
	}

	fs.mkdirSync(eventsPath, {recursive: true});
	return succeeded('Created events dir', true);
};

const removePath = (targetPath: string): void => {
	if (!fs.existsSync(targetPath)) return;
	fs.rmSync(targetPath, {recursive: true, force: true});
};

const validateOwnEventFileName = (fileName: string): Result<string> => {
	if (!fileName.endsWith('.jsonl')) {
		return failed('Own event file must end with .jsonl');
	}
	if (fileName.includes('/') || fileName.includes('\\')) {
		return failed('Own event file must be a file name, not a path');
	}
	if (fileName === '.' || fileName === '..' || fileName.trim() === '') {
		return failed('Own event file name is invalid');
	}

	return succeeded('Validated own event file name', fileName);
};

const listEventFiles = (root: string): Result<string[]> => {
	const eventsDir = getEventsDir(root);

	if (!fs.existsSync(eventsDir)) {
		return succeeded('Events dir missing', []);
	}

	return succeeded(
		'Listed event files',
		fs
			.readdirSync(eventsDir, {withFileTypes: true})
			.filter(entry => entry.isFile())
			.map(entry => entry.name)
			.filter(name => name.endsWith('.jsonl'))
			.sort(),
	);
};

const copyOwnEventFileToWorktree = ({
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
	const boardFile = getEventFilePath({
		root: worktreeRoot,
		fileName: ownEventFileName,
	});

	if (!fs.existsSync(localFile)) {
		return succeeded('Local own event file missing, nothing to copy', false);
	}

	const localContent = fs.readFileSync(localFile, 'utf8');
	const boardContent = fs.existsSync(boardFile)
		? fs.readFileSync(boardFile, 'utf8')
		: '';

	if (localContent === boardContent) {
		return succeeded('Own event file already matches board worktree', false);
	}

	fs.mkdirSync(path.dirname(boardFile), {recursive: true});
	fs.copyFileSync(localFile, boardFile);

	return succeeded('Copied own event file into board worktree', true);
};

const hydrateEventsFromWorktree = ({
	repoRoot,
	worktreeRoot,
	overwriteExisting = true,
}: {
	repoRoot: string;
	worktreeRoot: string;
	overwriteExisting?: boolean;
}): Result<boolean> => {
	const boardFilesResult = listEventFiles(worktreeRoot);
	if (isFail(boardFilesResult)) return failed(boardFilesResult.message);

	const boardEventsDir = getEventsDir(worktreeRoot);
	const localEventsDir = getEventsDir(repoRoot);
	let changed = false;

	for (const fileName of boardFilesResult.data) {
		const from = path.join(boardEventsDir, fileName);
		const to = path.join(localEventsDir, fileName);

		if (!overwriteExisting && fs.existsSync(to)) {
			continue;
		}

		const fromContent = fs.existsSync(from)
			? fs.readFileSync(from, 'utf8')
			: '';
		const toContent = fs.existsSync(to) ? fs.readFileSync(to, 'utf8') : '';

		if (fromContent === toContent) continue;

		fs.mkdirSync(path.dirname(to), {recursive: true});
		fs.copyFileSync(from, to);
		changed = true;
	}

	return succeeded('Hydrated event files from board worktree', changed);
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

	return succeeded(
		'Built sync commit message',
		`[epiq:sync:${sanitizeRefSegment(branchResult.data)}:${sanitizeRefSegment(
			shaResult.data,
		)}]`,
	);
};

const ensureLocalBoardBranch = async ({
	repoRoot,
}: {
	repoRoot: string;
}): Promise<Result<boolean>> => {
	const localResult = await hasLocalBranch({repoRoot, branch: BOARD_BRANCH});
	if (isFail(localResult)) return failed(localResult.message);
	if (localResult.data) {
		return succeeded('Local board branch already exists', false);
	}

	const remoteResult = await hasRemote({repoRoot, remote: DEFAULT_REMOTE});
	if (isFail(remoteResult)) return failed(remoteResult.message);

	if (remoteResult.data) {
		const remoteBranchResult = await hasRemoteBranch({
			repoRoot,
			remote: DEFAULT_REMOTE,
			branch: BOARD_BRANCH,
		});
		if (isFail(remoteBranchResult)) return failed(remoteBranchResult.message);

		if (remoteBranchResult.data) {
			const fetchResult = await execGit({
				args: ['fetch', DEFAULT_REMOTE, BOARD_BRANCH],
				cwd: repoRoot,
			});
			if (isFail(fetchResult)) {
				return failed(
					`Failed to fetch ${BOARD_BRANCH} from remote\n${fetchResult.message}`,
				);
			}

			const createFromRemote = await execGit({
				args: [
					'branch',
					'--track',
					BOARD_BRANCH,
					`${DEFAULT_REMOTE}/${BOARD_BRANCH}`,
				],
				cwd: repoRoot,
			});
			if (isFail(createFromRemote)) {
				return failed(
					`Failed to create local ${BOARD_BRANCH} from remote\n${createFromRemote.message}`,
				);
			}

			return succeeded('Created local board branch from remote', true);
		}
	}

	const createLocal = await execGit({
		args: ['branch', BOARD_BRANCH, 'HEAD'],
		cwd: repoRoot,
	});
	if (isFail(createLocal)) {
		return failed(
			`Failed to create local ${BOARD_BRANCH}\n${createLocal.message}`,
		);
	}

	return succeeded('Created local board branch', true);
};

const createBoardWorktree = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	const ensureRoot = ensureDir(path.dirname(worktreeRoot));
	if (isFail(ensureRoot)) return failed(ensureRoot.message);

	if (
		fs.existsSync(worktreeRoot) &&
		!fs.existsSync(path.join(worktreeRoot, '.git'))
	) {
		removePath(worktreeRoot);
	}

	const result = await execGit({
		args: ['worktree', 'add', worktreeRoot, BOARD_BRANCH],
		cwd: repoRoot,
	});
	if (isFail(result)) {
		return failed(`Failed to create board worktree\n${result.message}`);
	}

	return succeeded('Created board worktree', true);
};

const ensureBoardWorktree = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	const registeredResult = await hasWorktree({repoRoot, worktreeRoot});
	if (isFail(registeredResult)) return failed(registeredResult.message);

	const existsOnDisk = fs.existsSync(worktreeRoot);
	if (registeredResult.data && existsOnDisk) {
		return succeeded('Board worktree already exists', false);
	}

	if (registeredResult.data && !existsOnDisk) {
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

	return createBoardWorktree({repoRoot, worktreeRoot});
};

const ensureBoardBranchCheckedOut = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const currentBranchResult = await getCurrentBranchName(worktreeRoot);
	if (isFail(currentBranchResult)) return failed(currentBranchResult.message);

	if (currentBranchResult.data === BOARD_BRANCH) {
		return succeeded('Board branch already checked out', false);
	}

	const checkoutResult = await execGit({
		args: ['checkout', BOARD_BRANCH],
		cwd: worktreeRoot,
	});
	if (isFail(checkoutResult)) {
		return failed(
			`Failed to checkout ${BOARD_BRANCH}\n${checkoutResult.message}`,
		);
	}

	return succeeded('Checked out board branch', true);
};

const ensureBoardUpstream = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(worktreeRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);
	if (upstreamResult.data) {
		return succeeded('Board upstream already configured', false);
	}

	const remoteResult = await hasRemote({
		repoRoot: worktreeRoot,
		remote: DEFAULT_REMOTE,
	});
	if (isFail(remoteResult)) return failed(remoteResult.message);
	if (!remoteResult.data) {
		return succeeded('No remote available for upstream', false);
	}

	const remoteBranchResult = await hasRemoteBranch({
		repoRoot: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: BOARD_BRANCH,
	});
	if (isFail(remoteBranchResult)) return failed(remoteBranchResult.message);

	if (remoteBranchResult.data) {
		const fetchResult = await execGit({
			args: ['fetch', DEFAULT_REMOTE, BOARD_BRANCH],
			cwd: worktreeRoot,
		});
		if (isFail(fetchResult)) {
			return failed(`Failed to fetch ${BOARD_BRANCH}\n${fetchResult.message}`);
		}

		const setUpstreamResult = await execGit({
			args: [
				'branch',
				'--set-upstream-to',
				`${DEFAULT_REMOTE}/${BOARD_BRANCH}`,
				BOARD_BRANCH,
			],
			cwd: worktreeRoot,
		});
		if (isFail(setUpstreamResult)) {
			return failed(
				`Failed to set board upstream\n${setUpstreamResult.message}`,
			);
		}

		return succeeded('Configured board upstream', true);
	}

	const pushResult = await execGit({
		args: ['push', '-u', DEFAULT_REMOTE, BOARD_BRANCH],
		cwd: worktreeRoot,
	});
	if (isFail(pushResult)) {
		return failed(`Failed to publish board branch\n${pushResult.message}`);
	}

	return succeeded('Published board branch and configured upstream', true);
};

const stageBoardOwnEventFile = async ({
	worktreeRoot,
	ownEventFileName,
}: {
	worktreeRoot: string;
	ownEventFileName: string;
}): Promise<Result<void>> => {
	const result = await execGit({
		args: ['add', getRelativeEventFilePath(ownEventFileName)],
		cwd: worktreeRoot,
	});

	if (isFail(result)) {
		return failed(`Failed to stage board own event file\n${result.message}`);
	}

	return succeeded('Staged board own event file', undefined);
};

const hasStagedBoardOwnEventFileChange = async ({
	worktreeRoot,
	ownEventFileName,
}: {
	worktreeRoot: string;
	ownEventFileName: string;
}): Promise<Result<boolean>> => {
	const result = await execGit({
		args: [
			'diff',
			'--cached',
			'--quiet',
			'--',
			getRelativeEventFilePath(ownEventFileName),
		],
		cwd: worktreeRoot,
	});

	if (isFail(result)) {
		if (result.message.includes('git diff --cached --quiet')) {
			return succeeded('Has staged board own event file change', true);
		}
		return failed(result.message);
	}

	return succeeded('No staged board own event file change', false);
};

const createBoardSyncCommit = async ({
	repoRoot,
	worktreeRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ownEventFileName: string;
}): Promise<Result<string | null>> => {
	const hasChangesResult = await hasStagedBoardOwnEventFileChange({
		worktreeRoot,
		ownEventFileName,
	});
	if (isFail(hasChangesResult)) return failed(hasChangesResult.message);
	if (!hasChangesResult.data) {
		return succeeded('No board own event file commit needed', null);
	}

	const messageResult = await buildSyncCommitMessage(repoRoot);
	if (isFail(messageResult)) return failed(messageResult.message);

	const commitResult = await execGit({
		args: ['commit', '-m', messageResult.data],
		cwd: worktreeRoot,
	});
	if (isFail(commitResult)) {
		return failed(
			`Failed to commit board own event file\n${commitResult.message}`,
		);
	}

	const shaResult = await execGit({
		args: ['rev-parse', 'HEAD'],
		cwd: worktreeRoot,
	});
	if (isFail(shaResult)) return failed(shaResult.message);

	return succeeded('Created board sync commit', shaResult.data.stdout.trim());
};

const pushBoard = async (worktreeRoot: string): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(worktreeRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);
	if (!upstreamResult.data) {
		return succeeded('No upstream configured, skipped push', false);
	}

	const result = await execGit({
		args: ['push'],
		cwd: worktreeRoot,
	});
	if (isFail(result)) {
		return failed(`Failed during board push\n${result.message}`);
	}

	return succeeded('Pushed board', true);
};

const bootstrapBoardStorageBase = async ({
	repoRoot,
	worktreeRoot,
	ensureUpstream,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ensureUpstream: boolean;
}): Promise<Result<boolean>> => {
	let changed = false;

	for (const step of [
		ensureEpiqStorage(),
		await ensureLocalBoardBranch({repoRoot}),
		await ensureBoardWorktree({repoRoot, worktreeRoot}),
		await ensureBoardBranchCheckedOut(worktreeRoot),
		ensureUpstream
			? await ensureBoardUpstream(worktreeRoot)
			: succeeded('Skipped upstream bootstrap', false),
	] as Result[]) {
		if (isFail(step)) return failed(step.message);
		changed = changed || Boolean(step.data);
	}

	return succeeded(
		ensureUpstream
			? 'Bootstrapped board storage'
			: 'Bootstrapped board storage (readonly)',
		changed,
	);
};

const ensureBoardLayout = (
	repoRoot: string,
	worktreeRoot: string,
): Result<void> => {
	for (const result of [
		ensureEpiqDir(repoRoot),
		ensureEpiqDir(worktreeRoot),
		ensureEventsDir(repoRoot),
		ensureEventsDir(worktreeRoot),
	]) {
		if (isFail(result)) return failed(result.message);
	}
	return succeeded('Ensured board layout', undefined);
};

export const syncEpiqWithRemote = async ({
	cwd = process.cwd(),
	ownEventFileName,
}: SyncArgs): Promise<Result<SyncSummary>> => {
	const ownFileResult = validateOwnEventFileName(ownEventFileName);
	if (isFail(ownFileResult)) return failed(ownFileResult.message);

	const repoRootResult = await getRepoRoot(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.data;
	const worktreeRoot = getBoardWorktreeRoot(repoRoot);

	for (const check of [
		await hasInProgressGitOperation(repoRoot),
		await hasStagedChanges(repoRoot),
	]) {
		if (isFail(check)) return failed(check.message);
		if (check.data) {
			return failed(
				check.message.includes('staged')
					? 'Cannot run :sync while staged changes exist. Please commit or unstage them first.'
					: 'Cannot run :sync while a merge, rebase, cherry-pick, or revert is in progress in the current repo',
			);
		}
	}

	const initResult = await ensureInitialCommit(repoRoot);
	if (isFail(initResult)) return failed(initResult.message);

	const bootstrapResult = await bootstrapBoardStorageBase({
		repoRoot,
		worktreeRoot,
		ensureUpstream: true,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const boardOpResult = await hasInProgressGitOperation(worktreeRoot);
	if (isFail(boardOpResult)) return failed(boardOpResult.message);
	if (boardOpResult.data) {
		return failed(
			'Cannot run :sync while a merge, rebase, cherry-pick, or revert is in progress in the board worktree',
		);
	}

	const layoutResult = ensureBoardLayout(repoRoot, worktreeRoot);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	let createdCommit = false;
	let commitSha: string | undefined;
	let pulled = false;
	let pushed = false;
	let hydrated = false;

	// Pull first so the worktree reflects latest remote state before comparing/copying.
	const pullResult = await pullBranchRebaseIfPresent({
		cwd: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: BOARD_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);
	pulled = pullResult.data;

	const copyOwnResult = copyOwnEventFileToWorktree({
		repoRoot,
		worktreeRoot,
		ownEventFileName: ownFileResult.data,
	});
	if (isFail(copyOwnResult)) return failed(copyOwnResult.message);

	if (copyOwnResult.data) {
		const stageResult = await stageBoardOwnEventFile({
			worktreeRoot,
			ownEventFileName: ownFileResult.data,
		});
		if (isFail(stageResult)) return failed(stageResult.message);

		const commitResult = await createBoardSyncCommit({
			repoRoot,
			worktreeRoot,
			ownEventFileName: ownFileResult.data,
		});
		if (isFail(commitResult)) return failed(commitResult.message);

		createdCommit = Boolean(commitResult.data);
		commitSha = commitResult.data ?? undefined;
	}

	const pushResult = await pushBoard(worktreeRoot);
	if (isFail(pushResult)) {
		return failed(
			[
				pushResult.message,
				createdCommit && commitSha
					? `Local board sync commit exists: ${commitSha}`
					: '',
			]
				.filter(Boolean)
				.join('\n'),
		);
	}
	pushed = pushResult.data;

	const hydrateResult = hydrateEventsFromWorktree({
		repoRoot,
		worktreeRoot,
		overwriteExisting: true,
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);
	hydrated = hydrateResult.data;

	return succeeded('Synced board event logs via git', {
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
	const repoRootResult = await getRepoRoot(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.data;
	const worktreeRoot = getBoardWorktreeRoot(repoRoot);

	const repoOpResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(repoOpResult)) return failed(repoOpResult.message);
	if (repoOpResult.data) {
		return failed(
			'Cannot sync while a git operation is in progress in the current repo',
		);
	}

	const initResult = await ensureInitialCommit(repoRoot);
	if (isFail(initResult)) return failed(initResult.message);

	const bootstrapResult = await bootstrapBoardStorageBase({
		repoRoot,
		worktreeRoot,
		ensureUpstream: false,
	});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const boardOpResult = await hasInProgressGitOperation(worktreeRoot);
	if (isFail(boardOpResult)) return failed(boardOpResult.message);
	if (boardOpResult.data) {
		return failed(
			'Cannot sync while a git operation is in progress in the board worktree',
		);
	}

	const layoutResult = ensureBoardLayout(repoRoot, worktreeRoot);
	if (isFail(layoutResult)) return failed(layoutResult.message);

	const pullResult = await pullBranchRebaseIfPresent({
		cwd: worktreeRoot,
		remote: DEFAULT_REMOTE,
		branch: BOARD_BRANCH,
	});
	if (isFail(pullResult)) return failed(pullResult.message);

	const hydrateResult = hydrateEventsFromWorktree({
		repoRoot,
		worktreeRoot,
		overwriteExisting: false,
	});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);

	return succeeded('Synced from remote', {
		repoRoot,
		worktreeRoot,
	});
};
