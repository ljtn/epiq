import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {execGit} from '../git/git-utils.js';
import {resetHardToRemoteState, syncEpiqWithRemote} from '../git/sync.js';
import {isFail} from '../lib/model/result-types.js';
import {getRelativeEventFilePath} from '../git/git-storage.js';

const tempDirs: string[] = [];
let originalHome: string | undefined;

const makeTempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-sync-'));
	tempDirs.push(dir);
	return dir;
};

const writeFile = (filePath: string, content: string): void => {
	fs.mkdirSync(path.dirname(filePath), {recursive: true});
	fs.writeFileSync(filePath, content, 'utf8');
};

const writeProjectFile = (repoRoot: string): void => {
	writeFile(
		path.join(repoRoot, '.epiq', 'project.json'),
		JSON.stringify(
			{
				projectId: path.basename(repoRoot),
				stateBranch: 'epiq/state',
				createdAt: new Date(),
			},
			null,
			2,
		) + '\n',
	);
};

const eventLine = (id: string, ref: string | null = null): string =>
	JSON.stringify({
		v: 1,
		id: [id, ref],
		'lock.node': {},
	}) + '\n';

const getEventsFile = ({
	root,
	fileName,
}: {
	root: string;
	fileName: string;
}): string => path.join(root, getRelativeEventFilePath(fileName));

const initBareRepo = async (remoteRoot: string): Promise<void> => {
	const initResult = await execGit({
		args: ['init', '--bare'],
		cwd: remoteRoot,
	});
	if (isFail(initResult)) throw new Error(initResult.message);

	const headResult = await execGit({
		args: ['symbolic-ref', 'HEAD', 'refs/heads/main'],
		cwd: remoteRoot,
	});
	if (isFail(headResult)) throw new Error(headResult.message);
};

const cloneRepo = async ({
	remoteRoot,
	cloneRoot,
}: {
	remoteRoot: string;
	cloneRoot: string;
}): Promise<void> => {
	const cloneResult = await execGit({
		args: ['clone', remoteRoot, cloneRoot],
		cwd: path.dirname(cloneRoot),
	});
	if (isFail(cloneResult)) throw new Error(cloneResult.message);

	for (const [key, value] of [
		['user.name', 'Test User'],
		['user.email', 'test@example.com'],
	] as const) {
		const configResult = await execGit({
			args: ['config', key, value],
			cwd: cloneRoot,
		});
		if (isFail(configResult)) throw new Error(configResult.message);
	}
};

const commitFile = async ({
	repoRoot,
	fileName,
	content,
	message,
}: {
	repoRoot: string;
	fileName: string;
	content: string;
	message: string;
}): Promise<void> => {
	writeFile(path.join(repoRoot, fileName), content);

	const addResult = await execGit({
		args: ['add', fileName],
		cwd: repoRoot,
	});
	if (isFail(addResult)) throw new Error(addResult.message);

	const commitResult = await execGit({
		args: ['commit', '-m', message],
		cwd: repoRoot,
	});
	if (isFail(commitResult)) throw new Error(commitResult.message);
};

const setupRepo = async (): Promise<{
	remoteRoot: string;
	repoRoot: string;
}> => {
	const remoteRoot = makeTempDir();
	const repoRoot = makeTempDir();

	await initBareRepo(remoteRoot);
	await cloneRepo({remoteRoot, cloneRoot: repoRoot});
	writeProjectFile(repoRoot);

	await commitFile({
		repoRoot,
		fileName: 'README.md',
		content: 'hello\n',
		message: 'initial',
	});

	const pushResult = await execGit({
		args: ['push', '-u', 'origin', 'main'],
		cwd: repoRoot,
	});
	if (isFail(pushResult)) throw new Error(pushResult.message);

	return {remoteRoot, repoRoot};
};

beforeEach(() => {
	originalHome = process.env['HOME'];
	process.env['HOME'] = makeTempDir();
});

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env['HOME'];
	} else {
		process.env['HOME'] = originalHome;
	}

	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

describe('sync', () => {
	it('allows write sync when main repo is in detached HEAD state', async () => {
		const {repoRoot} = await setupRepo();

		const shaResult = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: repoRoot,
		});
		if (isFail(shaResult)) throw new Error(shaResult.message);

		const detachResult = await execGit({
			args: ['checkout', shaResult.value.stdout.trim()],
			cwd: repoRoot,
		});
		if (isFail(detachResult)) throw new Error(detachResult.message);

		const syncResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: 'u1.alice.jsonl',
		});

		expect(isFail(syncResult)).toBe(false);
	});

	it('write sync is a no-op for own file when state branch already matches', async () => {
		const {repoRoot} = await setupRepo();
		const ownEventFileName = 'u1.alice.jsonl';

		const bootResult = await resetHardToRemoteState(repoRoot);
		if (isFail(bootResult)) throw new Error(bootResult.message);

		writeFile(
			getEventsFile({
				root: bootResult.value.stateBranchRoot,
				fileName: ownEventFileName,
			}),
			eventLine('01H00000000000000000000001'),
		);

		const firstSync = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
		if (isFail(firstSync)) throw new Error(firstSync.message);

		const secondSync = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});

		expect(isFail(secondSync)).toBe(false);
		if (!isFail(secondSync)) {
			expect(secondSync.value.createdCommit).toBe(false);
		}
	});
});
