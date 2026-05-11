import fs from 'node:fs';
import path from 'node:path';
import {ensureLocalEpiqIgnored} from '../../../git/ensure-local-events-ignored.js';
import {git} from '../../../git/git-commands.js';
import {
	ensureWorktreesDir,
	getRepoRootDir,
	getWorktreesRoot,
} from '../../../git/git-storage.js';
import {
	commitAndGetSha,
	execGit,
	hasInProgressGitOperation,
	hasLocalBranch,
} from '../../../git/git-utils.js';
import {
	createStateBranch,
	ensureStateBranchWorktree,
	pushStateBranch,
	stageStateBranchOwnEventFile,
} from '../../../git/git.js';
import {navigationUtils} from '../../actions/default/navigation-action-utils.js';
import {getUserSetupStatus} from '../../config/setup-utils.js';
import {createDefaultEvents} from '../../event/event-boot.js';
import {materializeAll} from '../../event/event-materialize.js';
import {getPersistFileName, persist} from '../../event/event-persist.js';
import {Mode} from '../../model/action-map.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {
	ensureProjectFile,
	getProjectFileContents,
} from '../../project-setup/project-setup.js';
import {getSettingsState} from '../../state/settings.state.js';
import {getSafeState, patchState} from '../../state/state.js';
import {hasLocalProjectFile} from '../../storage/paths.js';

const hasDiff = async (repoRoot: string) => {
	const result = await execGit({
		cwd: repoRoot,
		args: ['status', '--porcelain'],
	});

	if (isFail(result)) return result;

	return succeeded('Checked git diff', result.value.stdout.trim().length > 0);
};

const failAt = (step: number, message: string) =>
	failed(`[${step}] ${message}`);

export const initCommand = async () => {
	const projectFileContents = getProjectFileContents();

	// 1. fail if not in git repo
	const repoRootResult = await getRepoRootDir(process.cwd());
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
			'Cannot initialize Epiq while a git operation is in progress',
		);
	}

	// 3. fail if there are files in the diff
	const diffResult = await hasDiff(repoRoot);
	if (isFail(diffResult)) {
		return failAt(2.5, diffResult.message);
	}

	if (diffResult.value) {
		return failAt(
			3,
			'Cannot initialize Epiq with uncommitted changes. Commit or stash your changes first.',
		);
	}

	// 4. fail if .epiq/project.json already exists
	if (hasLocalProjectFile(repoRoot)) {
		return failAt(4, 'Epiq project already initialized');
	}

	// 5. resolve user ids from ~/.epiq-global/config.json
	const setupStatus = getUserSetupStatus();
	if (!setupStatus.isSetupDone || !setupStatus.userName) {
		return failAt(
			5,
			'Missing Epiq user configuration (userId / userName). Run setup first.',
		);
	}

	const settings = getSettingsState();
	const userName = settings.userName;
	const userId = settings.userId;
	if (!userId || !userName) {
		return failAt(5, 'Missing Epiq user id');
	}

	// 6. create state branch (or fail if state branch already exists)
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

	// 10. commit initial event log on state branch
	const stageStateEventFileResult = await stageStateBranchOwnEventFile({
		stateBranchRoot,
		eventFileName: getPersistFileName({userId, userName}),
	});
	if (isFail(stageStateEventFileResult)) {
		return failAt(10, stageStateEventFileResult.message);
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

	const commitProjectResult = await git.commit({
		cwd: repoRoot,
		message: '[epiq:init-project]',
	});
	if (isFail(commitProjectResult)) {
		return failAt(13, commitProjectResult.message);
	}

	let successMessage = 'Project initialized!';

	// 14. try push original branch first.
	const pushOriginalResult = await execGit({
		cwd: repoRoot,
		args: ['push', '-u', 'origin', 'HEAD'],
	});
	if (isFail(pushOriginalResult)) {
		successMessage += ` Warn: [init:14] ${pushOriginalResult.message}`;
	}

	// 15. try push state branch / set upstream
	const pushStateResult = await pushStateBranch({
		repoRoot,
		stateBranchRoot,
	});
	if (isFail(pushStateResult)) {
		successMessage += ` Warn: [init:15] ${pushStateResult.message}`;
	}

	// 16. boot app from the same default events.
	// Do not persist again here; authoritative persistence already happened
	// in the state branch worktree above.
	const materializeResults = materializeAll(defaultEventsResult.value);
	const failures = materializeResults.filter(isFail);

	if (failures.length > 0) {
		return failAt(16, failures.map(f => f.message).join('\n'));
	}
	const stateResult = getSafeState();
	if (isFail(stateResult)) return failAt(16, stateResult.message);

	const {rootNodeId, nodes} = stateResult.value;
	const rootNode = nodes[rootNodeId];

	if (!rootNode) {
		return failAt(16, 'Unable to resolve initialized root node');
	}

	navigationUtils.navigate({
		contextNode: rootNode,
		selectedIndex: 0,
	});

	patchState({
		hasProjectDefinition: true,
		mode: Mode.DEFAULT,
	});

	return succeeded(successMessage, null);
};
