import fs from 'node:fs';
import path from 'node:path';
import {ensureLocalEpiqIgnored} from '../../git/ensure-local-events-ignored.js';
import {git} from '../../git/git-commands.js';
import {
	EMPTY_TREE_SHA,
	ensureWorktreesDir,
	getRepoRootDir,
	getWorktreesRoot,
} from '../../git/git-storage.js';
import {
	commitAndGetSha,
	execGit,
	execGitAllowFail,
	hasInProgressGitOperation,
	hasLocalBranch,
	hasRemote,
	hasRemoteBranch,
} from '../../git/git-utils.js';
import {
	createStateBranch,
	ensureInitialCommit,
	ensureLocalStateBranch,
	ensureStateBranchWorktree,
	getWorktreeRootForBranch,
	pushStateBranch,
	stageStateBranchOwnEventFile,
} from '../../git/git.js';
import {createDefaultEvents} from '../board/board-boot.js';
import {getPersistFileName, persist} from '../board/board-log.js';
import {flushPendingLogs} from '../event/pending-log.js';
import {AppEvent} from '../board/board-events.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {User} from '../state/settings.state.js';
import {logger} from '../../logger.js';
import {hasLocalProjectFile} from '../storage/paths.js';
import {
	ensureProjectFile,
	EpiqProject,
	getProjectFileContents,
} from './project-setup.js';
import {STATE_IDENTITY_PATH, writeStateIdentity} from './project-identity.js';

export type InitProjectOutcome = {
	repoRoot: string;
	projectId: string;
	stateBranch: string;
	stateBranchRoot: string;
	// The events the new board was written from, so a caller that keeps state
	// in memory can materialize them without reading the log back.
	defaultEvents: readonly AppEvent[];
	// Pushes are attempted, not required: a repo without a remote still
	// initializes, and what could not be published is reported here.
	warnings: string[];
};

// The paths `git status` reports, so a refusal can name what is in the way.
const dirtyPaths = async (repoRoot: string): Promise<Result<string[]>> => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['status', '--porcelain'],
	});

	if (isFail(result)) return result;

	return succeeded(
		'Checked git diff',
		result.value.stdout
			.split('\n')
			.filter(line => line.trim().length > 0)
			.map(line => line.slice(3)),
	);
};

const failAt = (step: number, message: string) =>
	failed(`[${step}] ${message}`);

// A remote is not required: without one, init says so once instead of failing twice to push.
export const NOT_PUSHED_NO_REMOTE =
	'Not pushed: this repository has no remote. Add one to share the board.';

const hasOrigin = async (repoRoot: string): Promise<boolean> => {
	const result = await hasRemote({repoRoot});
	// Unsure is treated as present: a push that fails says why.
	return isFail(result) || result.value;
};

/**
 * Turns a git repo into an epiq project, for every interface. Nothing else may
 * commit or push in the user's repository.
 */
export const initProject = async ({
	cwd,
	user,
}: {
	cwd: string;
	user: User;
}): Promise<Result<InitProjectOutcome>> => {
	const projectFileContents = getProjectFileContents();

	// 1. fail if not in git repo
	const repoRootResult = await getRepoRootDir(cwd);
	if (isFail(repoRootResult)) {
		return failAt(1, repoRootResult.message);
	}
	const repoRoot = repoRootResult.value;

	// 2. fail if pending git operation
	const pendingGitOperationResult = await hasInProgressGitOperation(repoRoot);
	if (isFail(pendingGitOperationResult)) {
		return failAt(2, pendingGitOperationResult.message);
	}
	if (pendingGitOperationResult.value) {
		return failAt(
			2,
			`Cannot initialize Epiq while a git operation is in progress: ${pendingGitOperationResult.value}`,
		);
	}

	// 3. fail if there are files in the diff
	const diffResult = await dirtyPaths(repoRoot);
	if (isFail(diffResult)) {
		return failAt(2.5, diffResult.message);
	}

	if (diffResult.value.length > 0) {
		return failAt(
			3,
			`Cannot initialize Epiq with uncommitted changes (${diffResult.value.join(
				', ',
			)}). Commit or stash your changes first.`,
		);
	}

	// 4. fail if .epiq/project.json already exists
	if (hasLocalProjectFile(repoRoot)) {
		return failAt(4, 'Epiq project already initialized');
	}

	// The project file is committed on HEAD's branch: on a detached HEAD it would
	// land on no branch, and checking one out would leave the board unreachable.
	const headBranch = await execGitAllowFail({
		cwd: repoRoot,
		args: ['symbolic-ref', '-q', 'HEAD'],
	});
	if (headBranch.exitCode !== 0) {
		return failAt(4, 'HEAD is detached. Check out a branch first.');
	}

	// Before anything is written, so a failure can put it back.
	const before = snapshotInitFiles(repoRoot);

	// 5. the author of the default board
	const {userId, userName} = user;
	if (!userId || !userName) {
		return failAt(5, 'Missing Epiq user id');
	}

	// 6. create state branch (or fail if state branch already exists)
	// A branch needs a commit, so an empty repo gets one here.
	const initialCommitResult = await ensureInitialCommit(repoRoot);
	if (isFail(initialCommitResult)) {
		return failAt(6, initialCommitResult.message);
	}

	const stateBranch = projectFileContents.stateBranch;
	const stateBranchExistsResult = await hasLocalBranch({
		repoRoot,
		branch: stateBranch,
	});

	if (isFail(stateBranchExistsResult)) {
		return failAt(6, stateBranchExistsResult.message);
	}

	if (stateBranchExistsResult.value) {
		const aborted = await dropAbortedStateBranch({repoRoot, stateBranch});
		if (isFail(aborted)) return failAt(6, aborted.message);
		// The board exists here, its project file only on another branch.
		if (!aborted.value)
			return adoptProject({repoRoot, stateBranch, from: 'local', before});
	}

	// A fresh clone of an existing project adopts origin's identity, never mints one.
	const remoteBranchResult = await hasRemoteStateBranch({
		repoRoot,
		stateBranch,
	});
	if (isFail(remoteBranchResult)) return failAt(6, remoteBranchResult.message);

	if (remoteBranchResult.value) {
		return adoptProject({repoRoot, stateBranch, from: 'remote', before});
	}

	const createStateBranchResult = await createStateBranch({
		repoRoot,
		stateBranchName: stateBranch,
	});
	if (isFail(createStateBranchResult)) {
		return failAt(6, createStateBranchResult.message);
	}

	const written = await writeNewBoard({
		repoRoot,
		user: {userId, userName},
		projectFileContents,
	});
	if (isFail(written)) {
		// Half a board refuses every later init, so a failure takes it all back.
		await undoInit({
			repoRoot,
			stateBranch,
			stateBranchRoot: path.join(
				getWorktreesRoot(),
				projectFileContents.projectId,
			),
			before,
		});
		return written;
	}
	const {stateBranchRoot, defaultEvents} = written.value;

	const warnings: string[] = [];

	if (!(await hasOrigin(repoRoot))) {
		warnings.push(NOT_PUSHED_NO_REMOTE);
	} else {
		// 14. try push original branch first.
		const pushOriginalResult = await execGit({
			cwd: repoRoot,
			args: ['push', '-u', 'origin', 'HEAD'],
		});
		if (isFail(pushOriginalResult)) {
			warnings.push(`[init:14] ${pushOriginalResult.message}`);
		}

		// 15. try push state branch / set upstream
		const pushStateResult = await pushStateBranch({
			repoRoot,
			stateBranchRoot,
		});
		if (isFail(pushStateResult)) {
			warnings.push(`[init:15] ${pushStateResult.message}`);
		}
	}

	return succeeded('Project initialized', {
		repoRoot,
		projectId: projectFileContents.projectId,
		stateBranch,
		stateBranchRoot,
		defaultEvents,
		warnings,
	});
};

// Steps 7 to 13: everything a failure must take back.
const writeNewBoard = async ({
	repoRoot,
	user: {userId, userName},
	projectFileContents,
}: {
	repoRoot: string;
	user: User;
	projectFileContents: EpiqProject;
}): Promise<
	Result<{stateBranchRoot: string; defaultEvents: readonly AppEvent[]}>
> => {
	const stateBranch = projectFileContents.stateBranch;

	// 7. ensure ~/.epiq-global/worktrees/ exists
	const ensureWorktreesDirResult = ensureWorktreesDir();
	if (isFail(ensureWorktreesDirResult)) {
		return failAt(7, ensureWorktreesDirResult.message);
	}

	// 8. ensure worktree for state branch exists
	const stateBranchRoot = path.join(
		getWorktreesRoot(),
		projectFileContents.projectId,
	);

	const ensureWorktreeResult = await ensureStateBranchWorktree({
		repoRoot,
		stateBranchRoot,
		stateBranchName: stateBranch,
	});
	if (isFail(ensureWorktreeResult)) {
		return failAt(8, ensureWorktreeResult.message);
	}

	// 9. write initial event log directly to authoritative state worktree
	const stateEpiqDir = path.join(stateBranchRoot, '.epiq');
	fs.mkdirSync(stateEpiqDir, {recursive: true});

	const defaultEventsResult = createDefaultEvents({userId, userName});
	if (isFail(defaultEventsResult)) {
		return failAt(9, defaultEventsResult.message);
	}

	for (const event of defaultEventsResult.value) {
		const persistResult = persist({event, rootDir: stateBranchRoot});
		if (isFail(persistResult)) return failAt(9, persistResult.message);
	}

	// Fold the pending log in, or the first commit has nothing to stage.
	const ownEventFileName = getPersistFileName({userId});

	const flushResult = flushPendingLogs(stateBranchRoot, ownEventFileName);
	if (isFail(flushResult)) return failAt(9, flushResult.message);

	// The branch carries the project's identity from its first commit, so a
	// clone that has lost its project file can adopt it rather than mint one.
	const identityResult = writeStateIdentity(
		stateBranchRoot,
		projectFileContents,
	);
	if (isFail(identityResult)) return failAt(9, identityResult.message);

	// 10. commit initial event log on state branch
	const stageStateEventFileResult = await stageStateBranchOwnEventFile({
		stateBranchRoot,
		eventFileName: ownEventFileName,
	});
	if (isFail(stageStateEventFileResult)) {
		return failAt(10, stageStateEventFileResult.message);
	}

	const stageIdentityResult = await git.stage({
		cwd: stateBranchRoot,
		pathspec: [STATE_IDENTITY_PATH],
	});
	if (isFail(stageIdentityResult)) {
		return failAt(10, stageIdentityResult.message);
	}

	const commitStateBranchResult = await commitAndGetSha({
		cwd: stateBranchRoot,
		message: '[epiq:init]',
	});
	if (isFail(commitStateBranchResult)) {
		return failAt(10, commitStateBranchResult.message);
	}

	// 11. ensure local-only paths are ignored.
	const ignoreResult = await ensureLocalEpiqIgnored(repoRoot);
	if (isFail(ignoreResult)) {
		return failAt(11, ignoreResult.message);
	}

	// 12. create .epiq/project.json
	const projectResult = ensureProjectFile({
		repoRoot,
		fileContents: projectFileContents,
	});
	if (isFail(projectResult)) {
		return failAt(12, projectResult.message);
	}

	// 13. commit .epiq/project.json on original branch
	const stageProjectResult = await git.stage({
		cwd: repoRoot,
		pathspec: ['.epiq/project.json', '.gitignore'],
	});
	if (isFail(stageProjectResult)) {
		return failAt(13, stageProjectResult.message);
	}

	// Pathspec, not a bare commit: without it this takes whatever else the user
	// happened to have staged in their own repo.
	const commitProjectResult = await git.commit({
		cwd: repoRoot,
		message: '[epiq:init-project]',
		pathspec: ['.epiq/project.json', '.gitignore'],
	});
	if (isFail(commitProjectResult)) {
		return failAt(13, commitProjectResult.message);
	}

	return succeeded('Board written', {
		stateBranchRoot,
		defaultEvents: defaultEventsResult.value,
	});
};

// The repository files init writes, as they were before it: a failure puts
// them back exactly, ignored or not, and unstages them.
const INIT_FILES = ['.epiq/project.json', '.gitignore'];
type InitFilesBefore = Record<string, string | null>;

const snapshotInitFiles = (repoRoot: string): InitFilesBefore =>
	Object.fromEntries(
		INIT_FILES.map(file => {
			const full = path.join(repoRoot, file);
			return [file, fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null];
		}),
	);

const restoreInitFiles = async (
	repoRoot: string,
	before: InitFilesBefore,
): Promise<void> => {
	// The tree was clean, so HEAD's index entries are what was staged.
	await execGitAllowFail({
		cwd: repoRoot,
		args: ['reset', '-q', '--', ...INIT_FILES],
	});
	for (const file of INIT_FILES) {
		const full = path.join(repoRoot, file);
		const content = before[file];
		if (content === null || content === undefined)
			fs.rmSync(full, {force: true});
		else fs.writeFileSync(full, content);
	}
};

// Inside epiq's worktrees directory, the only place it deletes a folder by hand.
const isOwnWorktree = (dir: string): boolean => {
	const real = (p: string) => {
		try {
			return fs.realpathSync(p);
		} catch {
			return path.resolve(p);
		}
	};
	return real(dir).startsWith(real(getWorktreesRoot()) + path.sep);
};

// Everything a failed first init wrote: the new branch, its worktree, the files.
const undoInit = async ({
	repoRoot,
	stateBranch,
	stateBranchRoot,
	before,
}: {
	repoRoot: string;
	stateBranch: string;
	stateBranchRoot: string;
	before: InitFilesBefore;
}): Promise<void> => {
	await execGitAllowFail({
		cwd: repoRoot,
		args: ['worktree', 'remove', '--force', stateBranchRoot],
	});
	if (isOwnWorktree(stateBranchRoot)) {
		fs.rmSync(stateBranchRoot, {recursive: true, force: true});
	}
	await execGitAllowFail({cwd: repoRoot, args: ['worktree', 'prune']});
	await execGitAllowFail({cwd: repoRoot, args: ['branch', '-D', stateBranch]});
	await restoreInitFiles(repoRoot, before);
};

/**
 * A state branch whose tip holds nothing was left by an init that failed before
 * its first commit (older versions did not take it back). Removed, so init can
 * start over; true if it was. A branch with anything on it is a board: kept.
 */
const dropAbortedStateBranch = async ({
	repoRoot,
	stateBranch,
}: {
	repoRoot: string;
	stateBranch: string;
}): Promise<Result<boolean>> => {
	const tree = await execGit({
		cwd: repoRoot,
		args: ['rev-parse', `${stateBranch}^{tree}`],
	});
	if (isFail(tree)) return failed(tree.message);
	if (tree.value.stdout.trim() !== EMPTY_TREE_SHA) {
		return succeeded('State branch holds a board', false);
	}

	// Empty for a moment in every init: one running here right now is not aborted.
	const committedAt = await execGit({
		cwd: repoRoot,
		args: ['log', '-1', '--format=%ct', stateBranch],
	});
	if (isFail(committedAt)) return failed(committedAt.message);
	if (Date.now() / 1000 - Number(committedAt.value.stdout.trim()) < 60) {
		return failed(
			`${stateBranch} was created moments ago: another init may be running here. Try again in a minute.`,
		);
	}

	const worktree = await getWorktreeRootForBranch({
		repoRoot,
		branch: stateBranch,
	});
	if (isFail(worktree)) return failed(worktree.message);
	if (worktree.value) {
		await execGitAllowFail({
			cwd: repoRoot,
			args: ['worktree', 'remove', '--force', worktree.value],
		});
		if (isOwnWorktree(worktree.value)) {
			fs.rmSync(worktree.value, {recursive: true, force: true});
		}
		await execGitAllowFail({cwd: repoRoot, args: ['worktree', 'prune']});
	}

	const removed = await execGit({
		cwd: repoRoot,
		args: ['branch', '-D', stateBranch],
	});
	if (isFail(removed)) return failed(removed.message);

	logger.info(`Removed ${stateBranch}, left empty by an earlier init`);
	return succeeded('Removed an aborted state branch', true);
};

// Whether origin already has the state branch, i.e. this clone joins an existing project.
const hasRemoteStateBranch = async ({
	repoRoot,
	stateBranch,
}: {
	repoRoot: string;
	stateBranch: string;
}): Promise<Result<boolean>> => {
	const remoteResult = await hasRemote({repoRoot});
	if (isFail(remoteResult)) return failed(remoteResult.message);
	if (!remoteResult.value) return succeeded('No remote', false);

	const branchResult = await hasRemoteBranch({repoRoot, branch: stateBranch});
	// Unreachable is not absent: init must not mint an id because the network
	// was down, so this is a refusal rather than a first init.
	if (isFail(branchResult)) {
		return failed(
			`Could not ask origin whether ${stateBranch} exists: ${branchResult.message}`,
		);
	}

	return branchResult;
};

/**
 * Makes this clone a checkout of origin's project, committing the branch's
 * identity as `.epiq/project.json`. A branch without one is refused.
 */
const adoptProject = async ({
	repoRoot,
	stateBranch,
	from,
	before,
}: {
	repoRoot: string;
	stateBranch: string;
	before: InitFilesBefore;
	// Origin's board for a fresh clone; this repository's own when its project
	// file is only on another branch.
	from: 'remote' | 'local';
}): Promise<Result<InitProjectOutcome>> => {
	if (from === 'remote') {
		const fetchResult = await execGit({
			cwd: repoRoot,
			args: ['fetch', 'origin', stateBranch],
		});
		if (isFail(fetchResult)) return failAt(6, fetchResult.message);
	}

	const source = from === 'remote' ? `origin/${stateBranch}` : stateBranch;
	const identityResult = await execGit({
		cwd: repoRoot,
		args: ['show', `${source}:${STATE_IDENTITY_PATH}`],
	});

	if (isFail(identityResult)) {
		return failAt(
			6,
			[
				`This repository is already an epiq project: ${
					from === 'remote' ? 'origin has' : 'it has'
				} the state branch ${stateBranch}.`,
				'Initialising again would mint a second id for the same board.',
				'',
				`The branch was written before branches carried their identity, so restore`,
				`${STATE_IDENTITY_PATH} from a checkout that has it, for example:`,
				'',
				`  git show origin/main:${STATE_IDENTITY_PATH} > ${STATE_IDENTITY_PATH}`,
				'',
				'and commit it; every later boot then stamps the branch, and the next clone adopts it.',
			].join('\n'),
		);
	}

	let project: EpiqProject;
	try {
		project = JSON.parse(identityResult.value.stdout) as EpiqProject;
	} catch (error) {
		return failAt(
			6,
			`The identity on ${source} is not readable: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	const projectResult = ensureProjectFile({repoRoot, fileContents: project});
	if (isFail(projectResult)) return failAt(12, projectResult.message);

	const stageResult = await git.stage({
		cwd: repoRoot,
		pathspec: [STATE_IDENTITY_PATH],
	});
	if (isFail(stageResult)) {
		await restoreInitFiles(repoRoot, before);
		return failAt(13, stageResult.message);
	}

	const commitResult = await git.commit({
		cwd: repoRoot,
		message: '[epiq:adopt-project]',
		pathspec: [STATE_IDENTITY_PATH],
	});
	if (isFail(commitResult)) {
		await restoreInitFiles(repoRoot, before);
		return failAt(13, commitResult.message);
	}

	const ensureWorktreesDirResult = ensureWorktreesDir();
	if (isFail(ensureWorktreesDirResult)) {
		return failAt(7, ensureWorktreesDirResult.message);
	}

	const stateBranchRoot = path.join(getWorktreesRoot(), project.projectId);

	const localBranchResult = await ensureLocalStateBranch({
		repoRoot,
		stateBranchName: stateBranch,
	});
	if (isFail(localBranchResult)) return failAt(8, localBranchResult.message);

	const ensureWorktreeResult = await ensureStateBranchWorktree({
		repoRoot,
		stateBranchRoot,
		stateBranchName: stateBranch,
	});
	if (isFail(ensureWorktreeResult)) {
		return failAt(8, ensureWorktreeResult.message);
	}

	const warnings: string[] = [];

	if (!(await hasOrigin(repoRoot))) {
		warnings.push(NOT_PUSHED_NO_REMOTE);
	} else {
		const pushResult = await execGit({
			cwd: repoRoot,
			args: ['push', '-u', 'origin', 'HEAD'],
		});
		if (isFail(pushResult)) warnings.push(`[init:14] ${pushResult.message}`);
	}

	return succeeded('Adopted the existing project', {
		repoRoot,
		projectId: project.projectId,
		stateBranch: project.stateBranch,
		stateBranchRoot,
		defaultEvents: [],
		warnings,
	});
};
