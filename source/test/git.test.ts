import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	execGit,
	isNonFastForward,
	pullBranchRebaseIfPresent,
} from '../git/git-utils.js';
import {syncEpiqWithRemote} from '../git/sync.js';
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

		const bootResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
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

describe('unpushed commits', () => {
	// A commit an earlier sync failed to push must still go out, even though
	// this run has nothing of its own to commit.
	it('pushes a commit left behind by an earlier run', async () => {
		const {repoRoot} = await setupRepo();
		const ownEventFileName = 'u1.alice.jsonl';

		const bootResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
		if (isFail(bootResult)) throw new Error(bootResult.message);

		const {stateBranchRoot} = bootResult.value;

		// Stands in for a run that committed and then failed to push.
		writeFile(
			getEventsFile({root: stateBranchRoot, fileName: ownEventFileName}),
			eventLine('01H00000000000000000000001'),
		);
		for (const args of [
			['add', getRelativeEventFilePath(ownEventFileName)],
			['commit', '-m', 'stranded'],
		]) {
			const step = await execGit({args, cwd: stateBranchRoot});
			if (isFail(step)) throw new Error(step.message);
		}

		const headResult = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: stateBranchRoot,
		});
		if (isFail(headResult)) throw new Error(headResult.message);
		const head = headResult.value.stdout.trim();

		const syncResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
		if (isFail(syncResult)) throw new Error(syncResult.message);

		expect(syncResult.value.createdCommit).toBe(false);
		expect(syncResult.value.bootstrapped).toBe(false);
		expect(syncResult.value.pushed).toBe(true);

		const remoteRefResult = await execGit({
			args: ['ls-remote', 'origin', 'refs/heads/epiq/state'],
			cwd: stateBranchRoot,
		});
		if (isFail(remoteRefResult)) throw new Error(remoteRefResult.message);

		expect(remoteRefResult.value.stdout).toContain(head);
	});
});

describe('sync commit scope', () => {
	// The state worktree has its own index; anything left staged in it by an
	// earlier run must not ride along in our commit.
	it('commits only what it staged, leaving other staged work alone', async () => {
		const {repoRoot} = await setupRepo();
		const ownEventFileName = 'u1.alice.jsonl';

		const bootResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
		if (isFail(bootResult)) throw new Error(bootResult.message);

		const {stateBranchRoot} = bootResult.value;

		writeFile(
			getEventsFile({root: stateBranchRoot, fileName: ownEventFileName}),
			eventLine('01H00000000000000000000001'),
		);

		writeFile(path.join(stateBranchRoot, 'stowaway.txt'), 'not ours\n');
		const stageResult = await execGit({
			args: ['add', 'stowaway.txt'],
			cwd: stateBranchRoot,
		});
		if (isFail(stageResult)) throw new Error(stageResult.message);

		const syncResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
		if (isFail(syncResult)) throw new Error(syncResult.message);
		expect(syncResult.value.createdCommit).toBe(true);

		const committed = await execGit({
			args: ['show', '--name-only', '--format=', 'HEAD'],
			cwd: stateBranchRoot,
		});
		if (isFail(committed)) throw new Error(committed.message);

		expect(committed.value.stdout).not.toContain('stowaway.txt');
		expect(committed.value.stdout).toContain(ownEventFileName);
	});
});

describe('pullBranchRebaseIfPresent', () => {
	const gitIn = async (cwd: string, args: string[]) => {
		const result = await execGit({args, cwd});
		if (isFail(result)) throw new Error(result.message);
		return result.value.stdout;
	};

	// Events land in the state worktree while a sync is running, so the pull has
	// to tolerate a dirty tree rather than aborting the rebase.
	it('pulls with an uncommitted change in the worktree', async () => {
		const root = makeTempDir();
		const remote = path.join(root, 'remote');
		const local = path.join(root, 'local');
		const other = path.join(root, 'other');

		fs.mkdirSync(remote, {recursive: true});
		await gitIn(remote, ['init', '--bare', '-q', '-b', 'main', '.']);

		await gitIn(root, ['clone', '-q', remote, 'local']);
		await gitIn(local, ['config', 'user.email', 'a@a']);
		await gitIn(local, ['config', 'user.name', 'a']);
		writeFile(path.join(local, 'events.jsonl'), 'one\n');
		await gitIn(local, ['add', '-A']);
		await gitIn(local, ['commit', '-qm', 'base']);
		await gitIn(local, ['push', '-q', 'origin', 'HEAD:main']);

		await gitIn(root, ['clone', '-q', remote, 'other']);
		await gitIn(other, ['config', 'user.email', 'b@b']);
		await gitIn(other, ['config', 'user.name', 'b']);
		writeFile(path.join(other, 'theirs.jsonl'), 'theirs\n');
		await gitIn(other, ['add', '-A']);
		await gitIn(other, ['commit', '-qm', 'remote side']);
		await gitIn(other, ['push', '-q', 'origin', 'main']);

		// The mid-sync append.
		writeFile(path.join(local, 'events.jsonl'), 'one\ntwo\n');

		const result = await pullBranchRebaseIfPresent({
			cwd: local,
			branch: 'main',
		});

		expect(isFail(result)).toBe(false);
		expect(fs.readFileSync(path.join(local, 'events.jsonl'), 'utf8')).toBe(
			'one\ntwo\n',
		);
		expect(fs.existsSync(path.join(local, 'theirs.jsonl'))).toBe(true);
		if (!isFail(result)) expect(result.value).toBe(true);
	});

	it('reports no pull when the remote has nothing new', async () => {
		const root = makeTempDir();
		const remote = path.join(root, 'remote');
		const local = path.join(root, 'local');

		fs.mkdirSync(remote, {recursive: true});
		await gitIn(remote, ['init', '--bare', '-q', '-b', 'main', '.']);
		await gitIn(root, ['clone', '-q', remote, 'local']);
		await gitIn(local, ['config', 'user.email', 'a@a']);
		await gitIn(local, ['config', 'user.name', 'a']);
		writeFile(path.join(local, 'f.txt'), 'x\n');
		await gitIn(local, ['add', '-A']);
		await gitIn(local, ['commit', '-qm', 'base']);
		await gitIn(local, ['push', '-q', 'origin', 'HEAD:main']);

		const result = await pullBranchRebaseIfPresent({
			cwd: local,
			branch: 'main',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) expect(result.value).toBe(false);
	});

	it('reports no pull when the branch is absent from the remote', async () => {
		const root = makeTempDir();
		const remote = path.join(root, 'remote');
		const local = path.join(root, 'local');

		fs.mkdirSync(remote, {recursive: true});
		await gitIn(remote, ['init', '--bare', '-q', '-b', 'main', '.']);
		await gitIn(root, ['clone', '-q', remote, 'local']);
		await gitIn(local, ['config', 'user.email', 'a@a']);
		await gitIn(local, ['config', 'user.name', 'a']);
		writeFile(path.join(local, 'f.txt'), 'x\n');
		await gitIn(local, ['add', '-A']);
		await gitIn(local, ['commit', '-qm', 'base']);

		const result = await pullBranchRebaseIfPresent({
			cwd: local,
			branch: 'nope',
		});

		expect(isFail(result)).toBe(false);
		if (!isFail(result)) expect(result.value).toBe(false);
	});
});

describe('isNonFastForward', () => {
	it('matches a rejection a rebase-and-retry can clear', () => {
		expect(
			isNonFastForward(
				' ! [rejected]        main -> main (fetch first)\n' +
					"error: failed to push some refs to 'origin'\n",
			),
		).toBe(true);

		expect(
			isNonFastForward(
				' ! [rejected]        main -> main (non-fast-forward)\n' +
					"error: failed to push some refs to 'origin'\n",
			),
		).toBe(true);
	});

	// Retrying would rewrite history for a rejection no rebase can clear.
	it('does not match a hook decline', () => {
		expect(
			isNonFastForward(
				'remote: policy: pushes to this branch are not allowed\n' +
					' ! [remote rejected] HEAD -> main (pre-receive hook declined)\n' +
					"error: failed to push some refs to 'origin'\n",
			),
		).toBe(false);
	});
});
