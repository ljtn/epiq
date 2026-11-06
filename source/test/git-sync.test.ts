import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it, onTestFinished, vi} from 'vitest';
import {execGit} from '../git/git-utils.js';
import {syncEpiqWithRemote} from '../git/sync.js';
import {isFail} from '../lib/model/result-types.js';
import {getRelativeEventFilePath} from '../git/git-storage.js';
import {
	eventLine,
	getEventsFile,
	setupRepo,
	useTempHome,
	writeFile,
} from './helpers/git-repo.js';

useTempHome();

const OWN_EVENT_FILE = 'u1.alice.jsonl';

const git = async (args: string[], cwd: string) => {
	const result = await execGit({args, cwd});
	if (isFail(result)) throw new Error(result.message);
	return result.value.stdout;
};

const sync = async (cwd: string) => {
	const result = await syncEpiqWithRemote({
		cwd,
		ownEventFileName: OWN_EVENT_FILE,
	});
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

describe('sync', () => {
	it('commits locally and reports no remote when the repo has no origin', async () => {
		const {repoRoot} = await setupRepo();
		const ownEventFileName = 'u1.alice.jsonl';

		const bootResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
		if (isFail(bootResult)) throw new Error(bootResult.message);

		const removeResult = await execGit({
			args: ['remote', 'remove', 'origin'],
			cwd: repoRoot,
		});
		if (isFail(removeResult)) throw new Error(removeResult.message);

		writeFile(
			getEventsFile({
				root: bootResult.value.stateBranchRoot,
				fileName: ownEventFileName,
			}),
			eventLine('01H00000000000000000000001'),
		);

		const syncResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
		if (isFail(syncResult)) throw new Error(syncResult.message);

		expect(syncResult.value.createdCommit).toBe(true);
		expect(syncResult.value.offline).toBe(true);
		expect(syncResult.message).toBe('Committed locally, no remote');

		const again = await syncEpiqWithRemote({cwd: repoRoot, ownEventFileName});
		if (isFail(again)) throw new Error(again.message);

		expect(again.value.createdCommit).toBe(false);
		expect(again.message).toBe('No remote');
	});

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

	it('publishes a board made before the repo had a remote', async () => {
		const {remoteRoot, repoRoot} = await setupRepo();
		const ownEventFileName = 'u1.alice.jsonl';

		const removeResult = await execGit({
			args: ['remote', 'remove', 'origin'],
			cwd: repoRoot,
		});
		if (isFail(removeResult)) throw new Error(removeResult.message);

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
		const localResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
		if (isFail(localResult)) throw new Error(localResult.message);
		expect(localResult.value.createdCommit).toBe(true);

		const addResult = await execGit({
			args: ['remote', 'add', 'origin', remoteRoot],
			cwd: repoRoot,
		});
		if (isFail(addResult)) throw new Error(addResult.message);

		const syncResult = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName,
		});
		if (isFail(syncResult)) throw new Error(syncResult.message);

		expect(syncResult.value.createdCommit).toBe(false);
		expect(syncResult.value.pushed).toBe(true);

		const headResult = await execGit({
			args: ['rev-parse', 'HEAD'],
			cwd: stateBranchRoot,
		});
		if (isFail(headResult)) throw new Error(headResult.message);

		const remoteRefResult = await execGit({
			args: ['ls-remote', 'origin', 'refs/heads/epiq/state'],
			cwd: stateBranchRoot,
		});
		if (isFail(remoteRefResult)) throw new Error(remoteRefResult.message);

		expect(remoteRefResult.value.stdout).toContain(
			headResult.value.stdout.trim(),
		);
	});

	const localBoardWithOrigin = async () => {
		const {remoteRoot, repoRoot} = await setupRepo();
		await git(['remote', 'remove', 'origin'], repoRoot);

		const boot = await sync(repoRoot);
		writeFile(
			getEventsFile({
				root: boot.stateBranchRoot,
				fileName: OWN_EVENT_FILE,
			}),
			eventLine('01H00000000000000000000001'),
		);
		await sync(repoRoot);

		await git(['remote', 'add', 'origin', remoteRoot], repoRoot);
		return {remoteRoot, repoRoot, stateBranchRoot: boot.stateBranchRoot};
	};

	it('does not fail every sync on a remote that refuses the board', async () => {
		const {remoteRoot, repoRoot, stateBranchRoot} =
			await localBoardWithOrigin();
		const hook = path.join(remoteRoot, 'hooks', 'pre-receive');
		const attempts = path.join(remoteRoot, 'attempts');
		writeFile(hook, `#!/bin/sh\necho x >> "${attempts}"\nexit 1\n`);
		fs.chmodSync(hook, 0o755);
		const attemptCount = () =>
			fs.readFileSync(attempts, 'utf8').trim().split('\n').length;
		const now = Date.now();
		const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
		onTestFinished(() => clock.mockRestore());

		for (const _ of [1, 2]) {
			const refused = await syncEpiqWithRemote({
				cwd: repoRoot,
				ownEventFileName: OWN_EVENT_FILE,
			});
			if (isFail(refused)) throw new Error(refused.message);

			expect(refused.message).toBe('Not published');
			expect(refused.value.offline).toBe(true);
			expect(refused.value.pushed).toBe(false);
		}

		expect(attemptCount()).toBe(1);

		clock.mockReturnValue(now + 5 * 60_000);
		await sync(repoRoot);
		expect(attemptCount()).toBe(2);

		// New work still reports the refusal.
		const eventsFile = getEventsFile({
			root: stateBranchRoot,
			fileName: OWN_EVENT_FILE,
		});
		fs.appendFileSync(eventsFile, eventLine('01H00000000000000000000002'));
		const write = await syncEpiqWithRemote({
			cwd: repoRoot,
			ownEventFileName: OWN_EVENT_FILE,
		});
		expect(isFail(write)).toBe(true);
		expect(attemptCount()).toBe(3);

		fs.rmSync(hook);
		clock.mockReturnValue(now + 10 * 60_000);
		expect((await sync(repoRoot)).pushed).toBe(true);
	});

	it('leaves a state branch deleted on the remote deleted', async () => {
		const {remoteRoot, repoRoot} = await setupRepo();
		await sync(repoRoot);

		await git(['update-ref', '-d', 'refs/heads/epiq/state'], remoteRoot);
		await git(['fetch', '--prune', 'origin'], repoRoot);

		expect((await sync(repoRoot)).pushed).toBe(false);
		expect(await git(['for-each-ref', 'refs/heads/epiq'], remoteRoot)).toBe('');
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
