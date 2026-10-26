// The project's id, also kept on the state branch: a boot refuses a mismatch with
// the checkout's, and an unstamped branch takes the first booting checkout's.
import fs from 'node:fs';
import path from 'node:path';
import {ORIGIN} from '../../git/git-constants.js';
import {execGit} from '../../git/git-utils.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getProjectFilePath} from '../storage/paths.js';
import {EpiqProject, readProjectFile} from './project-setup.js';

// The same path as in a checkout, so `git show <state branch>:.epiq/project.json`
// answers the question a person would ask.
export const STATE_IDENTITY_PATH = '.epiq/project.json';

export const getStateIdentityPath = (stateBranchRoot: string): string =>
	path.join(stateBranchRoot, STATE_IDENTITY_PATH);

/** The identity the state branch carries, or null for a branch stamped by nothing yet. */
export const readStateIdentity = (
	stateBranchRoot: string,
): Result<EpiqProject | null> => {
	if (!fs.existsSync(getStateIdentityPath(stateBranchRoot))) {
		return succeeded('State branch carries no identity yet', null);
	}

	const result = readProjectFile(stateBranchRoot);
	if (isFail(result)) return failed(`On the state branch: ${result.message}`);

	return succeeded('Read the state branch identity', result.value);
};

export const writeStateIdentity = (
	stateBranchRoot: string,
	project: EpiqProject,
): Result<void> => {
	try {
		const target = getStateIdentityPath(stateBranchRoot);
		fs.mkdirSync(path.dirname(target), {recursive: true});
		fs.writeFileSync(target, JSON.stringify(project, null, 2) + '\n', 'utf8');

		return succeeded('Wrote the state branch identity', undefined);
	} catch (error) {
		return failed(
			error instanceof Error
				? `Failed to write the state branch identity: ${error.message}`
				: 'Failed to write the state branch identity',
		);
	}
};

/** What a person reads when two ids meet: which is which, and the way out. */
export const describeIdentityMismatch = ({
	checkout,
	branch,
	stateBranch,
}: {
	checkout: EpiqProject;
	branch: EpiqProject;
	stateBranch: string;
}): string =>
	[
		`This checkout's ${STATE_IDENTITY_PATH} names project ${checkout.projectId}`,
		`(created ${checkout.createdAt}), but the state branch ${stateBranch}`,
		`belongs to project ${branch.projectId} (created ${branch.createdAt}).`,
		'',
		'The branch holds the board, so its id is the one that counts. Point the',
		'checkout at it and commit the change:',
		'',
		`  git show ${stateBranch}:${STATE_IDENTITY_PATH} > ${STATE_IDENTITY_PATH}`,
		'',
		'A second id is minted when init runs in a checkout that has no',
		'project file while the state branch already exists; nothing on the',
		'board is lost by it, but every checkout has to agree on one.',
	].join('\n');

// A project file on a branch or in the index; null where there is none.
const showProjectFile = async (
	repoRoot: string,
	spec: string,
): Promise<Result<EpiqProject | null>> => {
	const shown = await execGit({cwd: repoRoot, args: ['show', spec]});
	if (isFail(shown)) return succeeded(`Nothing at ${spec}`, null);

	try {
		return succeeded(
			`Read ${spec}`,
			JSON.parse(shown.value.stdout) as EpiqProject,
		);
	} catch (error) {
		return failed(
			`${spec} is not a readable project file: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
};

/**
 * The state branch's identity as git holds it (local, else origin's), never via
 * the checkout's own file. Null before one is committed.
 */
export const readCommittedStateIdentity = async ({
	repoRoot,
	stateBranch,
}: {
	repoRoot: string;
	stateBranch: string;
}): Promise<Result<EpiqProject | null>> => {
	for (const ref of [stateBranch, `${ORIGIN}/${stateBranch}`]) {
		const shown = await showProjectFile(
			repoRoot,
			`${ref}:${STATE_IDENTITY_PATH}`,
		);
		if (isFail(shown)) return shown;
		if (shown.value !== null) return shown;
	}

	return succeeded('The state branch carries no committed identity', null);
};

/**
 * A staged project file whose id is not the state branch's, or null. The branch's
 * id is read from git, then from the state worktree for an unsynced stamp.
 */
export const findStagedIdentityDrift = async ({
	repoRoot,
	stateBranch,
	stateBranchRoot,
}: {
	repoRoot: string;
	stateBranch: string;
	stateBranchRoot: string | null;
}): Promise<Result<{checkout: EpiqProject; branch: EpiqProject} | null>> => {
	const staged = await showProjectFile(repoRoot, `:${STATE_IDENTITY_PATH}`);
	if (isFail(staged)) return staged;
	if (staged.value === null) return succeeded('No project file staged', null);

	const committed = await readCommittedStateIdentity({repoRoot, stateBranch});
	if (isFail(committed)) return committed;

	let branch = committed.value;
	if (branch === null && stateBranchRoot !== null) {
		const stamped = readStateIdentity(stateBranchRoot);
		if (isFail(stamped)) return stamped;
		branch = stamped.value;
	}

	if (branch === null) {
		return succeeded('The state branch has no identity to compare', null);
	}

	if (branch.projectId === staged.value.projectId) {
		return succeeded('The staged file and the state branch agree', null);
	}

	return succeeded('The staged file names another project', {
		checkout: staged.value,
		branch,
	});
};

export type IdentityCheck = 'matched' | 'stamped' | 'no-checkout-file';

/**
 * Boot proceeds only if branch and checkout agree on the project. An unstamped
 * branch takes the checkout's id; a checkout without a project file is left to init.
 */
export const verifyProjectIdentity = ({
	repoRoot,
	stateBranchRoot,
	stateBranch,
}: {
	repoRoot: string;
	stateBranchRoot: string;
	stateBranch: string;
}): Result<IdentityCheck> => {
	if (!fs.existsSync(getProjectFilePath(repoRoot))) {
		return succeeded('No project file to compare', 'no-checkout-file');
	}

	const checkout = readProjectFile(repoRoot);
	if (isFail(checkout)) return failed(checkout.message);

	const branch = readStateIdentity(stateBranchRoot);
	if (isFail(branch)) return failed(branch.message);

	if (branch.value === null) {
		const written = writeStateIdentity(stateBranchRoot, checkout.value);
		if (isFail(written)) return failed(written.message);

		return succeeded('Stamped the state branch with this project', 'stamped');
	}

	if (branch.value.projectId !== checkout.value.projectId) {
		return failed(
			describeIdentityMismatch({
				checkout: checkout.value,
				branch: branch.value,
				stateBranch,
			}),
		);
	}

	return succeeded('The checkout and the state branch agree', 'matched');
};
