import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {isFail} from '../lib/command-line/command-types.js';
import {execGit} from '../git/git-utils.js';
import {syncEpiqFromRemote, syncEpiqWithRemote} from '../git/sync.js';
import {REMOTE_BRANCH} from '../git/git.js';

const tempDirs: string[] = [];
let originalHome: string | undefined;

const makeTempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-sync-'));
	tempDirs.push(dir);
	return dir;
};

const eventLine = (id: string, ref: string | null = null): string =>
	JSON.stringify({
		v: 1,
		id: [id, ref],
		'lock.node': {},
	}) + '\n';

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

const writeFile = (filePath: string, content: string): void => {
	fs.mkdirSync(path.dirname(filePath), {recursive: true});
	fs.writeFileSync(filePath, content, 'utf8');
};

const readFile = (filePath: string): string =>
	fs.readFileSync(filePath, 'utf8');

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

const getEventsFile = ({
	repoRoot,
	fileName,
}: {
	repoRoot: string;
	fileName: string;
}): string => path.join(repoRoot, '.epiq', 'events', fileName);

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
	it('fails write sync when repo is in detached HEAD state', async () => {
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

		const pushResult = await execGit({
			args: ['push', '-u', 'origin', 'main'],
			cwd: repoRoot,
		});
		if (isFail(pushResult)) throw new Error(pushResult.message);

		const shaResult = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: repoRoot,
		});
		if (isFail(shaResult)) throw new Error(shaResult.message);

		const detachResult = await execGit({
			args: ['checkout', shaResult.data.stdout.trim()],
			cwd: repoRoot,
		});
		if (isFail(detachResult)) throw new Error(detachResult.message);

		const syncResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: 'u1.alice.jsonl',
		});

		expect(isFail(syncResult)).toBe(true);
		if (isFail(syncResult)) {
			expect(syncResult.message).toContain('detached HEAD state');
		}
	});

	it('write sync copies own event file to remote branch and reports a created commit', async () => {
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

		const pushResult = await execGit({
			args: ['push', '-u', 'origin', 'main'],
			cwd: repoRoot,
		});
		if (isFail(pushResult)) throw new Error(pushResult.message);

		const ownFileName = 'u1.alice.jsonl';
		const ownFilePath = getEventsFile({repoRoot, fileName: ownFileName});
		writeFile(ownFilePath, eventLine('01H00000000000000000000001'));

		const syncResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: ownFileName,
		});

		expect(isFail(syncResult)).toBe(false);
		if (!isFail(syncResult)) {
			expect(syncResult.data.createdCommit).toBe(true);
			expect(syncResult.data.commitSha).toMatch(/^[0-9a-f]{40}$/);
			expect(syncResult.data.pushed).toBe(true);
		}

		const verifyClone = makeTempDir();
		await cloneRepo({remoteRoot, cloneRoot: verifyClone});

		const checkoutStateBranch = await execGit({
			args: ['checkout', REMOTE_BRANCH],
			cwd: verifyClone,
		});
		if (isFail(checkoutStateBranch))
			throw new Error(checkoutStateBranch.message);

		const remoteEventFile = getEventsFile({
			repoRoot: verifyClone,
			fileName: ownFileName,
		});
		expect(fs.existsSync(remoteEventFile)).toBe(true);
		expect(readFile(remoteEventFile)).toBe(
			eventLine('01H00000000000000000000001'),
		);
	});

	it('readonly sync hydrates another users event file from remote state branch', async () => {
		const remoteRoot = makeTempDir();
		const repoA = makeTempDir();
		const repoB = makeTempDir();

		await initBareRepo(remoteRoot);
		await cloneRepo({remoteRoot, cloneRoot: repoA});

		await commitFile({
			repoRoot: repoA,
			fileName: 'README.md',
			content: 'hello\n',
			message: 'initial',
		});

		const pushResult = await execGit({
			args: ['push', '-u', 'origin', 'main'],
			cwd: repoA,
		});
		if (isFail(pushResult)) throw new Error(pushResult.message);

		await cloneRepo({remoteRoot, cloneRoot: repoB});

		const aliceFile = getEventsFile({
			repoRoot: repoA,
			fileName: 'u1.alice.jsonl',
		});
		writeFile(aliceFile, eventLine('01H00000000000000000000001'));

		const syncWriteResult = await syncEpiqWithRemote({
			cwd: repoA,
			ownEventFileName: 'u1.alice.jsonl',
		});
		if (isFail(syncWriteResult)) throw new Error(syncWriteResult.message);

		const syncReadResult = await syncEpiqFromRemote(repoB);
		if (isFail(syncReadResult)) throw new Error(syncReadResult.message);

		const hydratedFile = getEventsFile({
			repoRoot: repoB,
			fileName: 'u1.alice.jsonl',
		});
		expect(fs.existsSync(hydratedFile)).toBe(true);
		expect(readFile(hydratedFile)).toBe(
			eventLine('01H00000000000000000000001'),
		);
	});

	it('write sync hydrates other users files without overwriting own local file', async () => {
		const remoteRoot = makeTempDir();
		const repoA = makeTempDir();

		await initBareRepo(remoteRoot);
		await cloneRepo({remoteRoot, cloneRoot: repoA});

		await commitFile({
			repoRoot: repoA,
			fileName: 'README.md',
			content: 'hello\n',
			message: 'initial',
		});

		const pushMain = await execGit({
			args: ['push', '-u', 'origin', 'main'],
			cwd: repoA,
		});
		if (isFail(pushMain)) throw new Error(pushMain.message);

		const aliceFileName = 'u1.alice.jsonl';
		writeFile(
			getEventsFile({repoRoot: repoA, fileName: aliceFileName}),
			eventLine('01H00000000000000000000002'),
		);

		const firstSync = await syncEpiqWithRemote({
			cwd: repoA,
			ownEventFileName: aliceFileName,
		});
		if (isFail(firstSync)) throw new Error(firstSync.message);

		const repoB = makeTempDir();
		await cloneRepo({remoteRoot, cloneRoot: repoB});

		const bobFileName = 'u2.bob.jsonl';
		const bobLocalPath = getEventsFile({
			repoRoot: repoB,
			fileName: bobFileName,
		});
		writeFile(bobLocalPath, eventLine('01H00000000000000000000003'));

		const secondSync = await syncEpiqWithRemote({
			cwd: repoB,
			ownEventFileName: bobFileName,
		});
		if (isFail(secondSync)) throw new Error(secondSync.message);

		expect(readFile(bobLocalPath)).toBe(
			eventLine('01H00000000000000000000003'),
		);

		const aliceHydratedPath = getEventsFile({
			repoRoot: repoB,
			fileName: aliceFileName,
		});
		expect(fs.existsSync(aliceHydratedPath)).toBe(true);
		expect(readFile(aliceHydratedPath)).toBe(
			eventLine('01H00000000000000000000002'),
		);
	});

	it('write sync is a no-op for own file when remote worktree already matches', async () => {
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

		const pushMain = await execGit({
			args: ['push', '-u', 'origin', 'main'],
			cwd: repoRoot,
		});
		if (isFail(pushMain)) throw new Error(pushMain.message);

		const ownEventFileName = 'u1.alice.jsonl';
		writeFile(
			getEventsFile({repoRoot, fileName: ownEventFileName}),
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
			expect(secondSync.data.createdCommit).toBe(false);
		}
	});
});
