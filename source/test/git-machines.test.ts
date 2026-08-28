import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {execGit, hasInProgressGitOperation} from '../git/git-utils.js';
import {syncEpiqWithRemote} from '../git/sync.js';
import {isFail} from '../lib/model/result-types.js';
import {
	cloneRepo,
	eventLine,
	getEventsFile,
	makeTempDir,
	setupRepo,
	useTempHome,
	writeFile,
	writeProjectFile,
} from './helpers/git-repo.js';

useTempHome();

describe('sync across machines', () => {
	const setupActor = async (remoteRoot: string): Promise<string> => {
		const repoRoot = makeTempDir();
		await cloneRepo({remoteRoot, cloneRoot: repoRoot});
		writeProjectFile(repoRoot);
		return repoRoot;
	};

	const setRemoteUrl = async (repoRoot: string, url: string) => {
		const result = await execGit({
			args: ['remote', 'set-url', 'origin', url],
			cwd: repoRoot,
		});
		if (isFail(result)) throw new Error(result.message);
	};

	const syncActor = async (repoRoot: string, ownEventFileName: string) =>
		syncEpiqWithRemote({cwd: repoRoot, ownEventFileName});

	it('carries one machine event log to another', async () => {
		const {remoteRoot, repoRoot: alice} = await setupRepo();
		const bob = await setupActor(remoteRoot);

		const aliceBoot = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(aliceBoot)) throw new Error(aliceBoot.message);

		writeFile(
			getEventsFile({
				root: aliceBoot.value.stateBranchRoot,
				fileName: 'u1.alice.jsonl',
			}),
			eventLine('01H00000000000000000000001'),
		);

		const alicePush = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(alicePush)) throw new Error(alicePush.message);
		expect(alicePush.value.pushed).toBe(true);

		const bobSync = await syncActor(bob, 'u2.bob.jsonl');
		if (isFail(bobSync)) throw new Error(bobSync.message);

		const carried = getEventsFile({
			root: bobSync.value.stateBranchRoot,
			fileName: 'u1.alice.jsonl',
		});

		expect(fs.existsSync(carried)).toBe(true);
		expect(fs.readFileSync(carried, 'utf8')).toContain(
			'01H00000000000000000000001',
		);
	});

	// The offline commit is the one an earlier sync would strand: the next run
	// has nothing of its own to commit, so only the ahead check sends it.
	it('keeps an event and pushes it once an unreachable remote returns', async () => {
		const {remoteRoot, repoRoot: alice} = await setupRepo();

		const boot = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(boot)) throw new Error(boot.message);
		const {stateBranchRoot} = boot.value;

		await setRemoteUrl(alice, path.join(makeTempDir(), 'gone'));

		writeFile(
			getEventsFile({root: stateBranchRoot, fileName: 'u1.alice.jsonl'}),
			eventLine('01H00000000000000000000002'),
		);

		const offline = await syncActor(alice, 'u1.alice.jsonl');
		expect(isFail(offline)).toBe(true);

		// Committed locally even though the sync as a whole failed.
		const log = await execGit({
			args: ['log', '--oneline'],
			cwd: stateBranchRoot,
		});
		if (isFail(log)) throw new Error(log.message);
		expect(log.value.stdout.trim().split('\n').length).toBeGreaterThan(1);

		await setRemoteUrl(alice, remoteRoot);

		const back = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(back)) throw new Error(back.message);

		expect(back.value.createdCommit).toBe(false);
		expect(back.value.pushed).toBe(true);

		const bob = await setupActor(remoteRoot);
		const bobSync = await syncActor(bob, 'u2.bob.jsonl');
		if (isFail(bobSync)) throw new Error(bobSync.message);

		expect(
			fs.readFileSync(
				getEventsFile({
					root: bobSync.value.stateBranchRoot,
					fileName: 'u1.alice.jsonl',
				}),
				'utf8',
			),
		).toContain('01H00000000000000000000002');
	});

	it('reports offline with the work committed when the host does not resolve', async () => {
		const {repoRoot: alice} = await setupRepo();

		const boot = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(boot)) throw new Error(boot.message);
		const {stateBranchRoot} = boot.value;

		await setRemoteUrl(alice, 'https://epiq-offline.invalid/x.git');

		writeFile(
			getEventsFile({root: stateBranchRoot, fileName: 'u1.alice.jsonl'}),
			eventLine('01H00000000000000000000004'),
		);

		const result = await syncActor(alice, 'u1.alice.jsonl');

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;

		expect(result.value.offline).toBe(true);
		expect(result.value.createdCommit).toBe(true);
		expect(result.value.pushed).toBe(false);

		const log = await execGit({
			args: ['log', '--oneline'],
			cwd: stateBranchRoot,
		});
		if (isFail(log)) throw new Error(log.message);
		expect(log.value.stdout.trim().split('\n').length).toBeGreaterThan(1);
	});

	it('fails an offline sync promptly instead of hanging', async () => {
		const {repoRoot: alice} = await setupRepo();

		const boot = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(boot)) throw new Error(boot.message);

		await setRemoteUrl(alice, path.join(makeTempDir(), 'gone'));

		writeFile(
			getEventsFile({
				root: boot.value.stateBranchRoot,
				fileName: 'u1.alice.jsonl',
			}),
			eventLine('01H00000000000000000000003'),
		);

		const startedAt = Date.now();
		const offline = await syncActor(alice, 'u1.alice.jsonl');
		const elapsed = Date.now() - startedAt;

		expect(isFail(offline)).toBe(true);
		expect(elapsed).toBeLessThan(15_000);
	});

	it('converges when both machines write while apart', async () => {
		const {remoteRoot, repoRoot: alice} = await setupRepo();
		const bob = await setupActor(remoteRoot);

		const aliceBoot = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(aliceBoot)) throw new Error(aliceBoot.message);
		const bobBoot = await syncActor(bob, 'u2.bob.jsonl');
		if (isFail(bobBoot)) throw new Error(bobBoot.message);

		writeFile(
			getEventsFile({
				root: aliceBoot.value.stateBranchRoot,
				fileName: 'u1.alice.jsonl',
			}),
			eventLine('01H0000000000000000000000A'),
		);
		writeFile(
			getEventsFile({
				root: bobBoot.value.stateBranchRoot,
				fileName: 'u2.bob.jsonl',
			}),
			eventLine('01H0000000000000000000000B'),
		);

		const aliceSync = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(aliceSync)) throw new Error(aliceSync.message);

		// Bob is behind now, so his push is the one that has to rebase.
		const bobSync = await syncActor(bob, 'u2.bob.jsonl');
		if (isFail(bobSync)) throw new Error(bobSync.message);

		const aliceAgain = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(aliceAgain)) throw new Error(aliceAgain.message);

		for (const [root, file, id] of [
			[aliceAgain.value.stateBranchRoot, 'u2.bob.jsonl', 'B'],
			[bobSync.value.stateBranchRoot, 'u1.alice.jsonl', 'A'],
		] as const) {
			expect(
				fs.readFileSync(getEventsFile({root, fileName: file}), 'utf8'),
			).toContain(`01H000000000000000000000${id === 'A' ? '0A' : '0B'}`);
		}
	});

	// BZJR3VE: a rebase interrupted mid-flight — not a genuine content conflict —
	// used to wedge every later sync forever, because ensureSyncReady's guard
	// rejected before pullBranchRebaseIfPresent's own abort-and-retry could run.
	it('recovers from a stale rebase left behind by an earlier interrupted sync', async () => {
		const {remoteRoot, repoRoot: alice} = await setupRepo();
		const bob = await setupActor(remoteRoot);

		const aliceBoot = await syncActor(alice, 'u1.alice.jsonl');
		if (isFail(aliceBoot)) throw new Error(aliceBoot.message);
		const {stateBranchRoot} = aliceBoot.value;

		// Bob advances the remote past alice's local state-branch tip.
		const bobBoot = await syncActor(bob, 'u2.bob.jsonl');
		if (isFail(bobBoot)) throw new Error(bobBoot.message);

		// Alice has local work of her own, on top of her now-stale tip.
		writeFile(path.join(stateBranchRoot, 'marker.txt'), 'alice\n');
		for (const args of [
			['add', 'marker.txt'],
			['commit', '-m', 'alice local'],
		]) {
			const step = await execGit({args, cwd: stateBranchRoot});
			if (isFail(step)) throw new Error(step.message);
		}

		// Simulate a rebase that was interrupted after cleanly applying alice's
		// commit — not a content conflict, just a process that never got to
		// finish — by making the replay step itself fail.
		const fetch = await execGit({
			args: ['fetch', 'origin', 'epiq/state'],
			cwd: stateBranchRoot,
		});
		if (isFail(fetch)) throw new Error(fetch.message);

		const rebase = await execGit({
			args: ['rebase', '--exec', 'false', 'origin/epiq/state'],
			cwd: stateBranchRoot,
		});
		expect(isFail(rebase)).toBe(true);

		const inProgress = await hasInProgressGitOperation(stateBranchRoot);
		expect(isFail(inProgress)).toBe(false);
		if (!isFail(inProgress)) expect(inProgress.value).toBe(true);

		const result = await syncActor(alice, 'u1.alice.jsonl');

		expect(isFail(result)).toBe(false);
	});
});
