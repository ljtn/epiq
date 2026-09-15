import fs from 'node:fs';
import path from 'node:path';
import {ulid} from 'ulid';
import {describe, expect, it} from 'vitest';
import {getStateBranchRoot, getWorktreesRoot} from '../git/git-storage.js';
import {execGit} from '../git/git-utils.js';
import {
	ensureStateBranchWorktree,
	stageStateBranchEventConfig,
} from '../git/git.js';
import {isFail} from '../lib/model/result-types.js';
import {initProject} from '../lib/project-setup/init-project.js';
import {
	findStagedIdentityDrift,
	getStateIdentityPath,
	readCommittedStateIdentity,
	readStateIdentity,
	STATE_IDENTITY_PATH,
	verifyProjectIdentity,
	writeStateIdentity,
} from '../lib/project-setup/project-identity.js';
import {
	DEFAULT_STATE_BRANCH,
	readProjectFile,
} from '../lib/project-setup/project-setup.js';
import {
	cloneRepo,
	commitFile,
	initBareRepo,
	makeTempDir,
	useTempHome,
} from './helpers/git-repo.js';

useTempHome();

const user = {userId: '01HZZZZZZZZZZZZZZZZZZZZZZZ', userName: 'Jo'};

// A clone with a bare remote and one commit, and no epiq project yet.
const setupPlainRepo = async () => {
	const remoteRoot = makeTempDir();
	const repoRoot = makeTempDir();

	await initBareRepo(remoteRoot);
	await cloneRepo({remoteRoot, cloneRoot: repoRoot});
	await commitFile({
		repoRoot,
		fileName: 'README.md',
		content: 'hello\n',
		message: 'initial',
	});

	return {remoteRoot, repoRoot};
};

const git = async (cwd: string, args: string[]): Promise<string> => {
	const result = await execGit({cwd, args});
	if (isFail(result)) throw new Error(result.message);
	return result.value.stdout.trim();
};

const initialised = async () => {
	const repo = await setupPlainRepo();
	const result = await initProject({cwd: repo.repoRoot, user});
	if (isFail(result)) throw new Error(result.message);

	return {...repo, ...result.value};
};

// A second machine on a checkout without the project file — a branch from
// before it, a clone that lost it: the checkout that used to mint a second
// id. Its own global dir, so its state worktree does not collide with the
// first clone's, as each actor's does in the collab suite.
const secondClone = async (remoteRoot: string) => {
	const cloneRoot = makeTempDir();
	await cloneRepo({remoteRoot, cloneRoot});
	await git(cloneRoot, ['rm', '-q', STATE_IDENTITY_PATH]);
	await git(cloneRoot, [
		'commit',
		'-q',
		'-m',
		'a branch without the project file',
	]);
	process.env['EPIQ_GLOBAL_DIR'] = makeTempDir();

	return cloneRoot;
};

describe('the project identity on the state branch', () => {
	it('is written by init and committed with the board', async () => {
		const {repoRoot, stateBranchRoot, projectId} = await initialised();

		const onDisk = readStateIdentity(stateBranchRoot);
		if (isFail(onDisk)) throw new Error(onDisk.message);
		expect(onDisk.value?.projectId).toBe(projectId);

		const committed = JSON.parse(
			await git(repoRoot, [
				'show',
				`${DEFAULT_STATE_BRANCH}:${STATE_IDENTITY_PATH}`,
			]),
		) as {projectId: string};
		expect(committed.projectId).toBe(projectId);
	});

	it('lets a fresh clone adopt the project origin already holds, instead of minting a second id', async () => {
		const first = await initialised();
		const stateCommitsBefore = await git(first.repoRoot, [
			'rev-list',
			'--count',
			`origin/${DEFAULT_STATE_BRANCH}`,
		]);

		const cloneRoot = await secondClone(first.remoteRoot);
		expect(fs.existsSync(path.join(cloneRoot, STATE_IDENTITY_PATH))).toBe(
			false,
		);

		const adopted = await initProject({cwd: cloneRoot, user});
		if (isFail(adopted)) throw new Error(adopted.message);

		expect(adopted.value.projectId).toBe(first.projectId);
		expect(adopted.message).toContain('Adopted');

		const project = readProjectFile(cloneRoot);
		if (isFail(project)) throw new Error(project.message);
		expect(project.value.projectId).toBe(first.projectId);

		expect(await git(cloneRoot, ['log', '-1', '--format=%s'])).toBe(
			'[epiq:adopt-project]',
		);
		expect(adopted.value.stateBranchRoot).toBe(
			path.join(getWorktreesRoot(), first.projectId),
		);
		expect(fs.existsSync(adopted.value.stateBranchRoot)).toBe(true);

		// No second board was written: the branch on origin is as it was.
		await git(cloneRoot, ['fetch', 'origin', DEFAULT_STATE_BRANCH]);
		expect(
			await git(cloneRoot, [
				'rev-list',
				'--count',
				`origin/${DEFAULT_STATE_BRANCH}`,
			]),
		).toBe(stateCommitsBefore);
	});

	it('refuses to init a clone of a state branch that carries no identity', async () => {
		const first = await initialised();

		// A branch written before branches carried their identity.
		await git(first.stateBranchRoot, ['rm', '-q', STATE_IDENTITY_PATH]);
		await git(first.stateBranchRoot, [
			'commit',
			'-q',
			'-m',
			'before identities',
		]);
		await git(first.stateBranchRoot, ['push', 'origin', DEFAULT_STATE_BRANCH]);

		const cloneRoot = await secondClone(first.remoteRoot);
		const refused = await initProject({cwd: cloneRoot, user});

		expect(isFail(refused)).toBe(true);
		expect(refused.message).toContain('already an epiq project');
		expect(refused.message).toContain(
			`git show origin/main:${STATE_IDENTITY_PATH}`,
		);
		expect(fs.existsSync(path.join(cloneRoot, STATE_IDENTITY_PATH))).toBe(
			false,
		);
	});

	it('stamps a branch that has no identity with the checkout’s, and stages it for the next sync', async () => {
		const {repoRoot, stateBranchRoot, projectId} = await initialised();
		fs.rmSync(getStateIdentityPath(stateBranchRoot));

		const verdict = verifyProjectIdentity({
			repoRoot,
			stateBranchRoot,
			stateBranch: DEFAULT_STATE_BRANCH,
		});
		if (isFail(verdict)) throw new Error(verdict.message);
		expect(verdict.value).toBe('stamped');

		const stamped = readStateIdentity(stateBranchRoot);
		if (isFail(stamped)) throw new Error(stamped.message);
		expect(stamped.value?.projectId).toBe(projectId);

		const staged = await stageStateBranchEventConfig({stateBranchRoot});
		if (isFail(staged)) throw new Error(staged.message);
		expect(staged.value).toContain(STATE_IDENTITY_PATH);
	});

	it('names both ids and the way out when the checkout and the branch disagree', async () => {
		const {repoRoot, stateBranchRoot, projectId} = await initialised();
		const other = ulid();

		const written = writeStateIdentity(stateBranchRoot, {
			projectId: other,
			stateBranch: DEFAULT_STATE_BRANCH,
			createdAt: new Date().toISOString(),
		});
		if (isFail(written)) throw new Error(written.message);

		const verdict = verifyProjectIdentity({
			repoRoot,
			stateBranchRoot,
			stateBranch: DEFAULT_STATE_BRANCH,
		});

		expect(isFail(verdict)).toBe(true);
		expect(verdict.message).toContain(projectId);
		expect(verdict.message).toContain(other);
		expect(verdict.message).toContain(
			`git show ${DEFAULT_STATE_BRANCH}:${STATE_IDENTITY_PATH}`,
		);
	});

	// The commit that started JQS9XDR: a checkout stages a project file with a
	// second id. Read through the checkout's own id the branch's identity is
	// nowhere — that id names no worktree — so the drift has to be read off the
	// branch as git holds it.
	it('finds a staged id that is not the branch’s, where the checkout’s own id names no worktree', async () => {
		const {repoRoot, projectId} = await initialised();
		const drifted = ulid();

		fs.writeFileSync(
			path.join(repoRoot, STATE_IDENTITY_PATH),
			JSON.stringify(
				{
					projectId: drifted,
					stateBranch: DEFAULT_STATE_BRANCH,
					createdAt: new Date().toISOString(),
				},
				null,
				2,
			) + '\n',
		);
		await git(repoRoot, ['add', STATE_IDENTITY_PATH]);

		const throughTheCheckout = getStateBranchRoot({repoRoot});
		if (isFail(throughTheCheckout)) throw new Error(throughTheCheckout.message);
		expect(fs.existsSync(throughTheCheckout.value)).toBe(false);

		const committed = await readCommittedStateIdentity({
			repoRoot,
			stateBranch: DEFAULT_STATE_BRANCH,
		});
		if (isFail(committed)) throw new Error(committed.message);
		expect(committed.value?.projectId).toBe(projectId);

		const drift = await findStagedIdentityDrift({
			repoRoot,
			stateBranch: DEFAULT_STATE_BRANCH,
			stateBranchRoot: throughTheCheckout.value,
		});
		if (isFail(drift)) throw new Error(drift.message);
		expect(drift.value?.checkout.projectId).toBe(drifted);
		expect(drift.value?.branch.projectId).toBe(projectId);
	});

	it('finds no drift in a staged file that agrees with the branch, or with nothing staged', async () => {
		const {repoRoot, stateBranchRoot} = await initialised();

		const nothingStaged = await findStagedIdentityDrift({
			repoRoot,
			stateBranch: DEFAULT_STATE_BRANCH,
			stateBranchRoot,
		});
		if (isFail(nothingStaged)) throw new Error(nothingStaged.message);
		expect(nothingStaged.value).toBeNull();

		// The same file again, staged: what a sync or a rename of the state
		// branch would stage.
		await git(repoRoot, ['add', '-f', STATE_IDENTITY_PATH]);
		const agreeing = await findStagedIdentityDrift({
			repoRoot,
			stateBranch: DEFAULT_STATE_BRANCH,
			stateBranchRoot,
		});
		if (isFail(agreeing)) throw new Error(agreeing.message);
		expect(agreeing.value).toBeNull();
	});

	it('refuses to move the state worktree between two ids of one branch', async () => {
		const {repoRoot, projectId} = await initialised();

		// What JQS9XDR was: the checkout re-initialised under a new id while
		// the branch stays checked out under the old one.
		const drifted = ulid();
		fs.writeFileSync(
			path.join(repoRoot, STATE_IDENTITY_PATH),
			JSON.stringify(
				{
					projectId: drifted,
					stateBranch: DEFAULT_STATE_BRANCH,
					createdAt: new Date().toISOString(),
				},
				null,
				2,
			) + '\n',
		);

		const expected = getStateBranchRoot({repoRoot});
		if (isFail(expected)) throw new Error(expected.message);
		expect(path.basename(expected.value)).toBe(drifted);

		const result = await ensureStateBranchWorktree({
			repoRoot,
			stateBranchRoot: expected.value,
			stateBranchName: DEFAULT_STATE_BRANCH,
		});

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain(projectId);
		expect(result.message).toContain(drifted);
		expect(fs.existsSync(path.join(getWorktreesRoot(), projectId))).toBe(true);
		expect(fs.existsSync(expected.value)).toBe(false);
	});
});
