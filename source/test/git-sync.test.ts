import path from 'node:path';
import {describe, expect, it} from 'vitest';
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
