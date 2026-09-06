import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {getWorktreesRoot} from '../git/git-storage.js';
import {execGit} from '../git/git-utils.js';
import {getPersistFileName} from '../lib/event/event-persist.js';
import {isFail} from '../lib/model/result-types.js';
import {initProject} from '../lib/project-setup/init-project.js';
import {readProjectFile} from '../lib/project-setup/project-setup.js';
import {
	cloneRepo,
	commitFile,
	getEventsFile,
	initBareRepo,
	makeTempDir,
	useTempHome,
	writeFile,
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

const gitStdout = async (cwd: string, args: string[]): Promise<string> => {
	const result = await execGit({cwd, args});
	if (isFail(result)) throw new Error(result.message);
	return result.value.stdout.trim();
};

describe('initProject', () => {
	it('creates the state branch, the default board and project.json, and pushes both branches', async () => {
		const {remoteRoot, repoRoot} = await setupPlainRepo();

		const result = await initProject({cwd: repoRoot, user});
		if (isFail(result)) throw new Error(result.message);

		expect(result.value.warnings).toEqual([]);
		expect(result.value.repoRoot).toBe(fs.realpathSync(repoRoot));

		const project = readProjectFile(repoRoot);
		if (isFail(project)) throw new Error(project.message);
		expect(project.value.projectId).toBe(result.value.projectId);
		expect(project.value.stateBranch).toBe(result.value.stateBranch);

		expect(result.value.stateBranchRoot).toBe(
			path.join(getWorktreesRoot(), result.value.projectId),
		);
		expect(
			fs.existsSync(
				getEventsFile({
					root: result.value.stateBranchRoot,
					fileName: getPersistFileName(user),
				}),
			),
		).toBe(true);

		expect(await gitStdout(repoRoot, ['log', '-1', '--format=%s'])).toBe(
			'[epiq:init-project]',
		);
		expect(
			await gitStdout(result.value.stateBranchRoot, [
				'log',
				'-1',
				'--format=%s',
			]),
		).toBe('[epiq:init]');

		const remoteBranches = await gitStdout(remoteRoot, [
			'branch',
			'--format=%(refname:short)',
		]);
		expect(remoteBranches.split('\n').sort()).toEqual(
			['main', result.value.stateBranch].sort(),
		);

		// The default board is authored by the user handed in.
		expect(
			result.value.defaultEvents.every(
				event =>
					event.userId === user.userId && event.userName === user.userName,
			),
		).toBe(true);
	});

	it('refuses a repository with uncommitted changes', async () => {
		const {repoRoot} = await setupPlainRepo();
		writeFile(path.join(repoRoot, 'dirty.txt'), 'dirty\n');

		const result = await initProject({cwd: repoRoot, user});

		expect(isFail(result)).toBe(true);
		expect(result.message).toMatch(
			/^\[3\] .*uncommitted changes \(dirty.txt\)/,
		);
	});

	it('refuses a repository that is already a project', async () => {
		const {repoRoot} = await setupPlainRepo();

		const first = await initProject({cwd: repoRoot, user});
		if (isFail(first)) throw new Error(first.message);

		const second = await initProject({cwd: repoRoot, user});

		expect(isFail(second)).toBe(true);
		expect(second.message).toBe('[4] Epiq project already initialized');
	});

	it('initializes without a remote, reporting the failed pushes as warnings', async () => {
		const repoRoot = makeTempDir();
		await gitStdout(repoRoot, ['init', '-b', 'main']);
		await gitStdout(repoRoot, ['config', 'user.email', 'test@example.com']);
		await gitStdout(repoRoot, ['config', 'user.name', 'Test User']);
		await commitFile({
			repoRoot,
			fileName: 'README.md',
			content: 'hello\n',
			message: 'initial',
		});

		const result = await initProject({cwd: repoRoot, user});
		if (isFail(result)) throw new Error(result.message);

		expect(result.value.warnings).toHaveLength(2);
		expect(result.value.warnings[0]).toMatch(/^\[init:14\]/);
		expect(result.value.warnings[1]).toMatch(/^\[init:15\]/);
		expect(fs.existsSync(path.join(repoRoot, '.epiq', 'project.json'))).toBe(
			true,
		);
	});
});
