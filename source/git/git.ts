import {spawn} from 'node:child_process';
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

type GitExecResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

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
	userId: string;
	userName: string;
};

const EPIQ_DIR = getEpiqDirName();
const EVENTS_SUBDIR = 'events';
const BOARD_BRANCH = 'epiq-state';
const DEFAULT_REMOTE = 'origin';

const execGit = ({
	args,
	cwd,
}: {
	args: string[];
	cwd: string;
}): Promise<Result<GitExecResult>> =>
	new Promise(resolve => {
		if (!fs.existsSync(cwd)) {
			return resolve(failed(`Git cwd does not exist: ${cwd}`));
		}

		const child = spawn('git', args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', chunk => {
			stdout += chunk;
		});

		child.stderr.on('data', chunk => {
			stderr += chunk;
		});

		child.on('error', err => {
			resolve(
				failed([`git ${args.join(' ')}`, `cwd=${cwd}`, err.message].join('\n')),
			);
		});

		child.on('close', code => {
			const exitCode = code ?? 1;

			if (exitCode !== 0) {
				resolve(
					failed(
						[
							`git ${args.join(' ')}`,
							stderr.trim() || stdout.trim() || 'Git command failed',
						]
							.filter(Boolean)
							.join('\n'),
					),
				);
				return;
			}

			resolve(
				succeeded('Git command succeeded', {
					stdout,
					stderr,
					exitCode,
				}),
			);
		});
	});

const execGitAllowFail = ({
	args,
	cwd,
}: {
	args: string[];
	cwd: string;
}): Promise<GitExecResult> =>
	new Promise(resolve => {
		if (!fs.existsSync(cwd)) {
			return resolve({
				stdout: '',
				stderr: `Git cwd does not exist: ${cwd}`,
				exitCode: 1,
			});
		}

		const child = spawn('git', args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');

		child.stdout.on('data', chunk => {
			stdout += chunk;
		});

		child.stderr.on('data', chunk => {
			stderr += chunk;
		});

		child.on('error', err => {
			resolve({
				stdout,
				stderr: err.message,
				exitCode: 1,
			});
		});

		child.on('close', code => {
			resolve({
				stdout,
				stderr,
				exitCode: code ?? 1,
			});
		});
	});

const ensureInitialCommit = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const hasHead = await execGitAllowFail({
		args: ['rev-parse', '--verify', 'HEAD'],
		cwd: repoRoot,
	});

	if (hasHead.exitCode === 0) {
		return succeeded('Repo already initialized', false);
	}

	const commitResult = await execGit({
		args: ['commit', '--allow-empty', '-m', '[epiq:init]'],
		cwd: repoRoot,
	});

	if (isFail(commitResult)) {
		return failed(`Failed to create initial commit\n${commitResult.message}`);
	}

	return succeeded('Created initial commit', true);
};

const ensureDir = (dirPath: string): Result<void> => {
	fs.mkdirSync(dirPath, {recursive: true});
	return succeeded('Ensured directory', undefined);
};

const removePath = (targetPath: string): void => {
	if (!fs.existsSync(targetPath)) return;
	fs.rmSync(targetPath, {recursive: true, force: true});
};

const getRepoRoot = async (cwd = process.cwd()): Promise<Result<string>> => {
	const result = await execGit({args: ['rev-parse', '--show-toplevel'], cwd});

	if (isFail(result)) return failed('Not inside a Git repository');

	return succeeded('Resolved repo root', result.data.stdout.trim());
};

const getGitDir = async (repoRoot: string): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--git-dir'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	const gitDir = result.data.stdout.trim();
	const resolved = path.isAbsolute(gitDir)
		? gitDir
		: path.join(repoRoot, gitDir);

	return succeeded('Resolved git dir', resolved);
};

const hasInProgressGitOperation = async (
	repoRoot: string,
): Promise<Result<boolean>> => {
	const gitDirResult = await getGitDir(repoRoot);
	if (isFail(gitDirResult)) return failed(gitDirResult.message);

	const gitDir = gitDirResult.data;
	const markers = [
		'MERGE_HEAD',
		'CHERRY_PICK_HEAD',
		'REVERT_HEAD',
		'REBASE_HEAD',
		path.join('rebase-merge'),
		path.join('rebase-apply'),
	];

	const activeMarkers = markers.filter(marker =>
		fs.existsSync(path.join(gitDir, marker)),
	);

	return succeeded(
		'Checked for in-progress Git operation',
		activeMarkers.length > 0,
	);
};

const hasStagedChanges = async (repoRoot: string): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['diff', '--cached', '--quiet'],
		cwd: repoRoot,
	});

	if (result.exitCode === 0) return succeeded('No staged changes', false);
	if (result.exitCode === 1) return succeeded('Has staged changes', true);

	return failed(result.stderr.trim() || 'Unable to inspect staged changes');
};

const getRepoId = (repoRoot: string): string =>
	createHash('sha1').update(repoRoot).digest('hex').slice(0, 12);

const getEpiqHome = (): string => path.join(os.homedir(), '.epiq');
const getWorktreesRoot = (): string => path.join(getEpiqHome(), 'worktrees');

const getBoardWorktreeRoot = (repoRoot: string): string => {
	const repoId = getRepoId(repoRoot);
	return path.join(getWorktreesRoot(), repoId);
};

const getEpiqRoot = (root: string): string => path.join(root, EPIQ_DIR);
const getEventsDir = (root: string): string =>
	path.join(getEpiqRoot(root), EVENTS_SUBDIR);

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

const ensureEpiqStorage = (): Result<void> => {
	const homeResult = ensureDir(getEpiqHome());
	if (isFail(homeResult)) return failed(homeResult.message);

	const worktreesResult = ensureDir(getWorktreesRoot());
	if (isFail(worktreesResult)) return failed(worktreesResult.message);

	return succeeded('Ensured epiq storage', undefined);
};

const hasRemote = async ({
	repoRoot,
	remote,
}: {
	repoRoot: string;
	remote: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['remote', 'get-url', remote],
		cwd: repoRoot,
	});

	return succeeded('Checked remote', result.exitCode === 0);
};

const hasRemoteBranch = async ({
	repoRoot,
	remote,
	branch,
}: {
	repoRoot: string;
	remote: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['ls-remote', '--heads', remote, branch],
		cwd: repoRoot,
	});

	if (result.exitCode !== 0) {
		return failed(
			result.stderr.trim() ||
				`Unable to inspect remote branch ${remote}/${branch}`,
		);
	}

	const exists = result.stdout.trim().length > 0;
	return succeeded('Checked remote branch', exists);
};

const hasLocalBranch = async ({
	repoRoot,
	branch,
}: {
	repoRoot: string;
	branch: string;
}): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
		cwd: repoRoot,
	});

	if (result.exitCode === 0) return succeeded('Local branch exists', true);
	if (result.exitCode === 1) return succeeded('Local branch missing', false);

	return failed(result.stderr.trim() || `Unable to inspect branch ${branch}`);
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

const hasWorktree = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	const result = await execGit({
		args: ['worktree', 'list', '--porcelain'],
		cwd: repoRoot,
	});
	if (isFail(result)) return failed(result.message);

	const normalized = path.resolve(worktreeRoot);
	const exists = result.data.stdout
		.split('\n')
		.filter(line => line.startsWith('worktree '))
		.map(line => line.slice('worktree '.length))
		.map(p => path.resolve(p))
		.includes(normalized);

	return succeeded('Checked worktree registration', exists);
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
	const currentBranchResult = await execGit({
		args: ['rev-parse', '--abbrev-ref', 'HEAD'],
		cwd: worktreeRoot,
	});

	if (isFail(currentBranchResult)) return failed(currentBranchResult.message);

	const currentBranch = currentBranchResult.data.stdout.trim();
	if (currentBranch === BOARD_BRANCH) {
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

const hasUpstream = async (repoRoot: string): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
		cwd: repoRoot,
	});

	const exists = result.exitCode === 0 && result.stdout.trim().length > 0;

	return succeeded('Checked upstream', exists);
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

const fetchBoardRemote = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const remoteResult = await hasRemote({
		repoRoot: worktreeRoot,
		remote: DEFAULT_REMOTE,
	});
	if (isFail(remoteResult)) return failed(remoteResult.message);

	if (!remoteResult.data) {
		return succeeded('No remote configured, skipped fetch', false);
	}

	const result = await execGit({
		args: ['fetch', DEFAULT_REMOTE, BOARD_BRANCH],
		cwd: worktreeRoot,
	});

	if (isFail(result)) {
		return failed(`Failed to fetch ${BOARD_BRANCH}\n${result.message}`);
	}

	return succeeded('Fetched board remote', true);
};

const pullBoardRebase = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const upstreamResult = await hasUpstream(worktreeRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);

	if (!upstreamResult.data) {
		return succeeded('No upstream configured, skipped pull', false);
	}

	const result = await execGit({
		args: ['pull', '--rebase'],
		cwd: worktreeRoot,
	});

	if (isFail(result)) {
		return failed(`Failed during board pull --rebase\n${result.message}`);
	}

	return succeeded('Pulled board with rebase', true);
};

const listEventFiles = (root: string): Result<string[]> => {
	const eventsDir = getEventsDir(root);

	if (!fs.existsSync(eventsDir)) {
		return succeeded('Events dir missing', []);
	}

	const files = fs
		.readdirSync(eventsDir, {withFileTypes: true})
		.filter(entry => entry.isFile())
		.map(entry => entry.name)
		.filter(name => name.endsWith('.jsonl'))
		.sort();

	return succeeded('Listed event files', files);
};

const sanitizeFileSegment = (value: string): string =>
	value
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^A-Za-z0-9._-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-.]+|[-.]+$/g, '') || 'unknown';

const getOwnEventFileName = ({
	userId,
	userName,
}: {
	userId: string;
	userName: string;
}): string =>
	`${sanitizeFileSegment(userId)}.${sanitizeFileSegment(userName)}.jsonl`;

const readLines = (filePath: string): string[] => {
	if (!fs.existsSync(filePath)) return [];

	const raw = fs.readFileSync(filePath, 'utf8');
	if (raw.trim() === '') return [];

	return raw
		.split('\n')
		.map(line => line.trimEnd())
		.filter(Boolean);
};

const writeLines = ({
	filePath,
	lines,
}: {
	filePath: string;
	lines: string[];
}): Result<void> => {
	fs.mkdirSync(path.dirname(filePath), {recursive: true});
	const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';
	fs.writeFileSync(filePath, content, 'utf8');
	return succeeded('Wrote lines', undefined);
};

const mergeOwnEventFileIntoWorktree = ({
	repoRoot,
	worktreeRoot,
	ownEventFileName,
}: {
	repoRoot: string;
	worktreeRoot: string;
	ownEventFileName: string;
}): Result<boolean> => {
	const localFile = path.join(getEventsDir(repoRoot), ownEventFileName);
	const boardFile = path.join(getEventsDir(worktreeRoot), ownEventFileName);

	const localLines = readLines(localFile);
	const boardLines = readLines(boardFile);

	const merged = Array.from(new Set([...boardLines, ...localLines]));

	const boardBefore = boardLines.join('\n');
	const boardAfter = merged.join('\n');

	if (boardBefore === boardAfter) {
		return succeeded('Own event file already merged', false);
	}

	const writeResult = writeLines({filePath: boardFile, lines: merged});
	if (isFail(writeResult)) return failed(writeResult.message);

	return succeeded('Merged own event file into board worktree', true);
};

const hydrateEventsFromWorktree = ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Result<boolean> => {
	const boardFilesResult = listEventFiles(worktreeRoot);
	if (isFail(boardFilesResult)) return failed(boardFilesResult.message);

	const boardEventsDir = getEventsDir(worktreeRoot);
	const localEventsDir = getEventsDir(repoRoot);

	let changed = false;

	for (const fileName of boardFilesResult.data) {
		const from = path.join(boardEventsDir, fileName);
		const to = path.join(localEventsDir, fileName);

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

const stageBoardEvents = async (
	worktreeRoot: string,
): Promise<Result<void>> => {
	const result = await execGit({
		args: ['add', path.join(EPIQ_DIR, EVENTS_SUBDIR)],
		cwd: worktreeRoot,
	});

	if (isFail(result)) {
		return failed(
			`Failed to stage board ${path.join(EPIQ_DIR, EVENTS_SUBDIR)}\n${
				result.message
			}`,
		);
	}

	return succeeded('Staged board events', undefined);
};

const hasStagedBoardEventChanges = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const result = await execGitAllowFail({
		args: [
			'diff',
			'--cached',
			'--quiet',
			'--',
			path.join(EPIQ_DIR, EVENTS_SUBDIR),
		],
		cwd: worktreeRoot,
	});

	if (result.exitCode === 0) {
		return succeeded('No staged board event changes', false);
	}
	if (result.exitCode === 1) {
		return succeeded('Has staged board event changes', true);
	}

	return failed(
		result.stderr.trim() || 'Unable to inspect staged board event changes',
	);
};

const sanitizeRefSegment = (value: string): string =>
	value
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^A-Za-z0-9._/-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-/.]+|[-/.]+$/g, '') || 'unknown';

const getCurrentBranchName = async (
	repoRoot: string,
): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--abbrev-ref', 'HEAD'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved current branch', result.data.stdout.trim());
};

const getShortHeadSha = async (repoRoot: string): Promise<Result<string>> => {
	const result = await execGit({
		args: ['rev-parse', '--short', 'HEAD'],
		cwd: repoRoot,
	});

	if (isFail(result)) return failed(result.message);

	return succeeded('Resolved short HEAD sha', result.data.stdout.trim());
};

const buildSyncCommitMessage = async (
	repoRoot: string,
): Promise<Result<string>> => {
	const branchResult = await getCurrentBranchName(repoRoot);
	if (isFail(branchResult)) return failed(branchResult.message);

	const shaResult = await getShortHeadSha(repoRoot);
	if (isFail(shaResult)) return failed(shaResult.message);

	const branch = sanitizeRefSegment(branchResult.data);
	const sha = sanitizeRefSegment(shaResult.data);

	return succeeded('Built sync commit message', `[epiq:sync:${branch}:${sha}]`);
};

const createBoardSyncCommit = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<string | null>> => {
	const hasChangesResult = await hasStagedBoardEventChanges(worktreeRoot);
	if (isFail(hasChangesResult)) return failed(hasChangesResult.message);

	if (!hasChangesResult.data) {
		return succeeded('No board event commit needed', null);
	}

	const messageResult = await buildSyncCommitMessage(repoRoot);
	if (isFail(messageResult)) return failed(messageResult.message);

	const commitResult = await execGit({
		args: ['commit', '-m', messageResult.data],
		cwd: worktreeRoot,
	});

	if (isFail(commitResult)) {
		return failed(`Failed to commit board events\n${commitResult.message}`);
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

const bootstrapBoardStorage = async ({
	repoRoot,
	worktreeRoot,
}: {
	repoRoot: string;
	worktreeRoot: string;
}): Promise<Result<boolean>> => {
	let changed = false;

	const storageResult = ensureEpiqStorage();
	if (isFail(storageResult)) return failed(storageResult.message);

	const branchResult = await ensureLocalBoardBranch({repoRoot});
	if (isFail(branchResult)) return failed(branchResult.message);
	changed = changed || branchResult.data;

	const worktreeResult = await ensureBoardWorktree({repoRoot, worktreeRoot});
	if (isFail(worktreeResult)) return failed(worktreeResult.message);
	changed = changed || worktreeResult.data;

	const checkoutResult = await ensureBoardBranchCheckedOut(worktreeRoot);
	if (isFail(checkoutResult)) return failed(checkoutResult.message);
	changed = changed || checkoutResult.data;

	const upstreamResult = await ensureBoardUpstream(worktreeRoot);
	if (isFail(upstreamResult)) return failed(upstreamResult.message);
	changed = changed || upstreamResult.data;

	return succeeded('Bootstrapped board storage', changed);
};

export const syncEpiqWithRemote = async ({
	cwd = process.cwd(),
	userId,
	userName,
}: SyncArgs): Promise<Result<SyncSummary>> => {
	const repoRootResult = await getRepoRoot(cwd);
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const repoRoot = repoRootResult.data;
	const worktreeRoot = getBoardWorktreeRoot(repoRoot);

	const repoOpResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(repoOpResult)) return failed(repoOpResult.message);
	if (repoOpResult.data) {
		return failed(
			'Cannot run :sync while a merge, rebase, cherry-pick, or revert is in progress in the current repo',
		);
	}

	const stagedChangesResult = await hasStagedChanges(repoRoot);
	if (isFail(stagedChangesResult)) return failed(stagedChangesResult.message);
	if (stagedChangesResult.data) {
		return failed(
			'Cannot run :sync while staged changes exist. Please commit or unstage them first.',
		);
	}

	const initResult = await ensureInitialCommit(repoRoot);
	if (isFail(initResult)) return failed(initResult.message);

	const bootstrapResult = await bootstrapBoardStorage({repoRoot, worktreeRoot});
	if (isFail(bootstrapResult)) return failed(bootstrapResult.message);

	const boardOpResult = await hasInProgressGitOperation(worktreeRoot);
	if (isFail(boardOpResult)) return failed(boardOpResult.message);
	if (boardOpResult.data) {
		return failed(
			'Cannot run :sync while a merge, rebase, cherry-pick, or revert is in progress in the board worktree',
		);
	}

	const ensureLocalEpiqResult = ensureEpiqDir(repoRoot);
	if (isFail(ensureLocalEpiqResult))
		return failed(ensureLocalEpiqResult.message);

	const ensureBoardEpiqResult = ensureEpiqDir(worktreeRoot);
	if (isFail(ensureBoardEpiqResult))
		return failed(ensureBoardEpiqResult.message);

	const ensureLocalEventsResult = ensureEventsDir(repoRoot);
	if (isFail(ensureLocalEventsResult))
		return failed(ensureLocalEventsResult.message);

	const ensureBoardEventsResult = ensureEventsDir(worktreeRoot);
	if (isFail(ensureBoardEventsResult))
		return failed(ensureBoardEventsResult.message);

	let createdCommit = false;
	let commitSha: string | undefined;
	let pulled = false;
	let pushed = false;
	let hydrated = false;
	const bootstrapped = bootstrapResult.data;

	const fetchResult = await fetchBoardRemote(worktreeRoot);
	if (isFail(fetchResult)) return failed(fetchResult.message);

	const pullResult = await pullBoardRebase(worktreeRoot);
	if (isFail(pullResult)) return failed(pullResult.message);
	pulled = pullResult.data;

	const ownEventFileName = getOwnEventFileName({userId, userName});

	const mergeOwnResult = mergeOwnEventFileIntoWorktree({
		repoRoot,
		worktreeRoot,
		ownEventFileName,
	});
	if (isFail(mergeOwnResult)) return failed(mergeOwnResult.message);

	const stageResult = await stageBoardEvents(worktreeRoot);
	if (isFail(stageResult)) return failed(stageResult.message);

	const commitResult = await createBoardSyncCommit({repoRoot, worktreeRoot});
	if (isFail(commitResult)) return failed(commitResult.message);

	if (commitResult.data) {
		createdCommit = true;
		commitSha = commitResult.data;
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

	const hydrateResult = hydrateEventsFromWorktree({repoRoot, worktreeRoot});
	if (isFail(hydrateResult)) return failed(hydrateResult.message);
	hydrated = hydrateResult.data;

	return succeeded('Synced board event logs', {
		repoRoot,
		worktreeRoot,
		createdCommit,
		commitSha,
		pulled,
		pushed,
		hydrated,
		bootstrapped,
	});
};
