import fs from 'node:fs';
import path from 'node:path';
import {ensureLocalEpiqIgnored} from '../../git/ensure-local-events-ignored.js';
import {git} from '../../git/git-commands.js';
import {
	ensureWorktreesDir,
	getRepoRootDir,
	getWorktreesRoot,
} from '../../git/git-storage.js';
import {
	commitAndGetSha,
	execGit,
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
	pushStateBranch,
	stageStateBranchOwnEventFile,
} from '../../git/git.js';
import {createDefaultEvents} from '../event/event-boot.js';
import {getPersistFileName, persist} from '../event/event-persist.js';
import {flushPendingLogs} from '../event/pending-log.js';
import {AppEvent} from '../event/event.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {User} from '../state/settings.state.js';
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

/**
 * Turns a git repository into an epiq project: the state branch and its
 * worktree, the default board written to the user's event log, and
 * `.epiq/project.json` committed on the user's branch. Every interface — the
 * TUI's `:init`, the MCP's `epiq_project_init` — runs this; nothing else may
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

	// 5. the author of the default board
	const {userId, userName} = user;
	if (!userId || !userName) {
		return failAt(5, 'Missing Epiq user id');
	}

	// 6. create state branch (or fail if state branch already exists)
	// A branch needs a commit to point at, so a repo with none gets one here —
	// the only place epiq may write a commit in the user's own repository, and
	// only because they asked for it by running init.
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
		return failAt(6, `State branch already exists: ${stateBranch}`);
	}

	// A fresh clone has no local state branch and no project file, which is
	// exactly the checkout that used to mint a second id for a board that
	// already existed on origin (JQS9XDR). The branch there is the project:
	// adopt its identity when it carries one, and refuse when it does not.
	const remoteBranchResult = await hasRemoteStateBranch({
		repoRoot,
		stateBranch,
	});
	if (isFail(remoteBranchResult)) return failAt(6, remoteBranchResult.message);

	if (remoteBranchResult.value) {
		return adoptRemoteProject({repoRoot, stateBranch});
	}

	const createStateBranchResult = await createStateBranch({
		repoRoot,
		stateBranchName: stateBranch,
	});
	if (isFail(createStateBranchResult)) {
		return failAt(6, createStateBranchResult.message);
	}

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

	// Those appends went to the pending log, which is untracked by design and
	// ignored outright — so there would be nothing to stage, and the first
	// commit of a new project would fail with "nothing added to commit". Folded
	// in here for the same reason a sync folds them in: this is the moment the
	// tracked log is about to be handed to git.
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
	// .epiq/events is no longer used as storage, but keeping it ignored is harmless
	// for legacy directories and avoids accidental commits.
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

	const warnings: string[] = [];

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

	return succeeded('Project initialized', {
		repoRoot,
		projectId: projectFileContents.projectId,
		stateBranch,
		stateBranchRoot,
		defaultEvents: defaultEventsResult.value,
		warnings,
	});
};

// Whether origin already has the state branch: a repository that is already an
// epiq project, seen from a clone that does not know it yet. Offline, or with
// no remote at all, the answer is no, and init proceeds as a first init.
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
 * Makes this clone a checkout of the project origin already holds: the
 * identity comes off the state branch, is written and committed as
 * `.epiq/project.json` here, and the worktree is set up as a boot would set
 * it up. A branch that carries no identity — written before branches did —
 * cannot say which id it is, and the person is pointed at a checkout that can.
 */
const adoptRemoteProject = async ({
	repoRoot,
	stateBranch,
}: {
	repoRoot: string;
	stateBranch: string;
}): Promise<Result<InitProjectOutcome>> => {
	const fetchResult = await execGit({
		cwd: repoRoot,
		args: ['fetch', 'origin', stateBranch],
	});
	if (isFail(fetchResult)) return failAt(6, fetchResult.message);

	const identityResult = await execGit({
		cwd: repoRoot,
		args: ['show', `origin/${stateBranch}:${STATE_IDENTITY_PATH}`],
	});

	if (isFail(identityResult)) {
		return failAt(
			6,
			[
				`This repository is already an epiq project: origin has the state branch ${stateBranch}.`,
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
			`The identity on origin/${stateBranch} is not readable: ${
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
	if (isFail(stageResult)) return failAt(13, stageResult.message);

	const commitResult = await git.commit({
		cwd: repoRoot,
		message: '[epiq:adopt-project]',
		pathspec: [STATE_IDENTITY_PATH],
	});
	if (isFail(commitResult)) return failAt(13, commitResult.message);

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

	const pushResult = await execGit({
		cwd: repoRoot,
		args: ['push', '-u', 'origin', 'HEAD'],
	});
	if (isFail(pushResult)) warnings.push(`[init:14] ${pushResult.message}`);

	return succeeded('Adopted the project origin already holds', {
		repoRoot,
		projectId: project.projectId,
		stateBranch: project.stateBranch,
		stateBranchRoot,
		defaultEvents: [],
		warnings,
	});
};
