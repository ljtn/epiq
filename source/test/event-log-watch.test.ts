import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {decodeTime, ulid} from 'ulid';
import {reloadIfEventLogMoved} from '../git/event-log-watch.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {execGit, getGitDir} from '../git/git-utils.js';
import {ensureLocalStateBranch} from '../git/git.js';
import {SYNC_LOCK_FILE} from '../git/sync-lock.js';
import {loadProject, loadWithoutProject} from '../lib/boot/load-project.js';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {
	getEdgeRef,
	materializeAndPersistAll,
	toPersistedEvent,
} from '../lib/board/board-log.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {clearAccountedSignature} from '../lib/event/log-signature.js';
import {
	appendPendingLine,
	getPendingLogPath,
} from '../lib/event/pending-log.js';
import {NavNodeCtx} from '../lib/model/context.model.js';
import {isFail} from '../lib/model/result-types.js';
import {DEFAULT_STATE_BRANCH} from '../lib/project-setup/project-setup.js';
import {attachLineNodes} from '../lib/repository/line-nodes.js';
import {getState, patchState} from '../lib/state/state.js';
import {makeTempDir, useTempHome} from './helpers/git-repo.js';

const git = async (cwd: string, args: string[]) => {
	const result = await execGit({cwd, args});
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

// A local-only board: the same shape `load-project.test.ts` builds, minus the
// remote — the watch exists for writes a pull was never going to carry anyway.
const makeRepo = async (projectId: string): Promise<string> => {
	const repoRoot = path.join(makeTempDir(), projectId);
	fs.mkdirSync(repoRoot, {recursive: true});

	await git(repoRoot, ['init', '-q', '-b', 'main', '.']);
	await git(repoRoot, ['config', 'user.name', 'Test']);
	await git(repoRoot, ['config', 'user.email', 't@test']);
	fs.writeFileSync(path.join(repoRoot, 'README.md'), 'x\n');
	await git(repoRoot, ['add', '-A']);
	await git(repoRoot, ['commit', '-qm', 'init', '--no-verify']);

	fs.mkdirSync(path.join(repoRoot, '.epiq'), {recursive: true});
	fs.writeFileSync(
		path.join(repoRoot, '.epiq', 'project.json'),
		JSON.stringify({
			projectId,
			stateBranch: DEFAULT_STATE_BRANCH,
			createdAt: new Date().toISOString(),
		}),
	);

	const branch = await ensureLocalStateBranch({
		repoRoot,
		stateBranchName: DEFAULT_STATE_BRANCH,
	});
	if (isFail(branch)) throw new Error(branch.message);

	return repoRoot;
};

// A TUI booted on a seeded board, the way it is left after a first sync.
const bootBoard = async (
	projectId: string,
): Promise<{repoRoot: string; stateBranchRoot: string; swimlaneId: string}> => {
	const repoRoot = await makeRepo(projectId);

	const stateBranchRootResult = getStateBranchRoot({repoRoot});
	if (isFail(stateBranchRootResult)) {
		throw new Error(stateBranchRootResult.message);
	}
	const stateBranchRoot = stateBranchRootResult.value;

	loadWithoutProject();
	process.chdir(repoRoot);

	// The first boot puts the worktree in place for the seed to persist into.
	const bootstrapped = await loadProject(repoRoot);
	if (isFail(bootstrapped)) throw new Error(bootstrapped.message);

	const defaults = createDefaultEvents({userId: 'seed', userName: 'seed'});
	if (isFail(defaults)) throw new Error(defaults.message);

	const seeded = materializeAndPersistAll(
		[...defaults.value] as AppEvent[],
		stateBranchRoot,
	);
	if (isFail(seeded)) throw new Error(seeded.message);

	const loaded = await loadProject(repoRoot);
	if (isFail(loaded)) throw new Error(loaded.message);

	const swimlane = Object.values(getState().nodes).find(
		node => node.context === NavNodeCtx.SWIMLANE,
	);
	if (!swimlane) throw new Error('No swimlane on the seeded board');

	return {repoRoot, stateBranchRoot, swimlaneId: swimlane.id};
};

// What another process's persist leaves on disk: a line in its own pending
// log, minted past the edge it saw. Written without going through this
// process's state, which is the point.
const appendFromAnotherProcess = (
	stateBranchRoot: string,
	parent: string,
	name: string,
) => {
	const edge = getEdgeRef(stateBranchRoot);
	if (isFail(edge)) throw new Error(edge.message);

	const id = edge.value ? ulid(decodeTime(edge.value) + 1) : ulid();

	const entry = toPersistedEvent(
		{action: 'add.issue', payload: {id: ulid(), name, parent, rank: 'a0'}},
		[id, edge.value],
	);
	if (isFail(entry)) throw new Error(entry.message);

	appendPendingLine(
		getPendingLogPath(stateBranchRoot, 'otheractor.jsonl'),
		`${JSON.stringify(entry.value)}\n`,
	);
};

useTempHome();

let originalGlobalDir: string | undefined;
const originalCwd = process.cwd();

beforeEach(() => {
	(globalThis as {logger?: unknown}).logger = {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	};

	originalGlobalDir = process.env['EPIQ_GLOBAL_DIR'];
	process.env['EPIQ_GLOBAL_DIR'] = path.join(makeTempDir(), '.epiq-global');
});

afterEach(() => {
	if (originalGlobalDir === undefined) delete process.env['EPIQ_GLOBAL_DIR'];
	else process.env['EPIQ_GLOBAL_DIR'] = originalGlobalDir;

	process.chdir(originalCwd);
	clearAccountedSignature();
});

const titles = () => Object.values(getState().nodes).map(node => node.title);

describe('reloadIfEventLogMoved', () => {
	it('shows a write another process made to the same worktree', async () => {
		const {stateBranchRoot, swimlaneId} = await bootBoard(
			'01EVENTLOGWATCH00000000001',
		);

		const unchanged = await reloadIfEventLogMoved();
		expect(unchanged.status).toBe('success');
		expect(unchanged.message).toBe('Log unchanged');

		appendFromAnotherProcess(
			stateBranchRoot,
			swimlaneId,
			'landed from another process',
		);

		const moved = await reloadIfEventLogMoved();
		expect(isFail(moved)).toBe(false);
		expect(titles()).toContain('landed from another process');

		// Its own reload accounted for the log, so a second pass stays put.
		const again = await reloadIfEventLogMoved();
		expect(again.status).toBe('success');
		expect(again.message).toBe('Log unchanged');
	});

	it('does not reload for writes this process made itself', async () => {
		const {stateBranchRoot, swimlaneId} = await bootBoard(
			'01EVENTLOGWATCH00000000002',
		);

		const own = materializeAndPersistAll(
			[
				{
					id: ulid(),
					userId: 'own-actor',
					action: 'add.issue',
					payload: {
						id: ulid(),
						name: 'written by this process',
						parent: swimlaneId,
						rank: 'a1',
					},
				},
			] as AppEvent[],
			stateBranchRoot,
		);
		if (isFail(own)) throw new Error(own.message);

		const unchanged = await reloadIfEventLogMoved();
		expect(unchanged.status).toBe('success');
		expect(unchanged.message).toBe('Log unchanged');
	});

	it('waits off a virtual node rather than reading the log every pass', async () => {
		const {stateBranchRoot, swimlaneId} = await bootBoard(
			'01EVENTLOGWATCH00000000003',
		);

		const {contextNodeId, selectedIndex} = getState();

		// A cursor on a virtual row, as when reading a ticket's comments.
		attachLineNodes(swimlaneId, 2, index => `virtual-${index}`);
		patchState({contextNodeId: swimlaneId, selectedIndex: 0});
		expect(getState().selectedNode?.isVirtual).toBe(true);

		appendFromAnotherProcess(
			stateBranchRoot,
			swimlaneId,
			'landed while on a comment',
		);

		const skipped = await reloadIfEventLogMoved();
		expect(skipped.message).toBe('Skipped on a virtual node');

		patchState({contextNodeId, selectedIndex});
		expect(getState().selectedNode?.isVirtual).toBeFalsy();

		const moved = await reloadIfEventLogMoved();
		expect(isFail(moved)).toBe(false);
		expect(titles()).toContain('landed while on a comment');
	});

	it('leaves the worktree alone while another live process syncs it', async () => {
		const {stateBranchRoot, swimlaneId} = await bootBoard(
			'01EVENTLOGWATCH00000000004',
		);

		const gitDir = await getGitDir(stateBranchRoot);
		if (isFail(gitDir)) throw new Error(gitDir.message);
		const lockPath = path.join(gitDir.value, SYNC_LOCK_FILE);

		const holdLock = (pid: number) =>
			fs.writeFileSync(
				lockPath,
				JSON.stringify({
					pid,
					hostname: os.hostname(),
					startedAt: Date.now(),
					operation: 'sync',
				}),
			);

		appendFromAnotherProcess(
			stateBranchRoot,
			swimlaneId,
			'landed during a sync',
		);

		// The parent is alive for as long as this test runs.
		holdLock(process.ppid);

		const held = await reloadIfEventLogMoved();
		expect(held.message).toBe('Worktree held by a sync');
		expect(titles()).not.toContain('landed during a sync');

		// A holder that died without releasing does not stop the watch.
		const dead = spawnSync(process.execPath, ['-e', '']).pid;
		holdLock(dead);

		const moved = await reloadIfEventLogMoved();
		expect(isFail(moved)).toBe(false);
		expect(titles()).toContain('landed during a sync');

		fs.rmSync(lockPath, {force: true});
	});

	it('still checks the lock once a worktree that was missing appears', async () => {
		const {stateBranchRoot, swimlaneId} = await bootBoard(
			'01EVENTLOGWATCH00000000006',
		);

		// A tick during `:open`, before `loadProject` has made the worktree.
		const parked = `${stateBranchRoot}-parked`;
		fs.renameSync(stateBranchRoot, parked);

		// Any skip will do; the lookup has already run by then.
		patchState({readOnly: true});
		await reloadIfEventLogMoved();
		patchState({readOnly: false});

		fs.renameSync(parked, stateBranchRoot);

		const gitDir = await getGitDir(stateBranchRoot);
		if (isFail(gitDir)) throw new Error(gitDir.message);
		const lockPath = path.join(gitDir.value, SYNC_LOCK_FILE);

		fs.writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.ppid,
				hostname: os.hostname(),
				startedAt: Date.now(),
				operation: 'sync',
			}),
		);

		appendFromAnotherProcess(stateBranchRoot, swimlaneId, 'after the open');

		const held = await reloadIfEventLogMoved();
		expect(held.message).toBe('Worktree held by a sync');

		fs.rmSync(lockPath, {force: true});
	});

	it('waits for a project that is still loading', async () => {
		const {repoRoot, stateBranchRoot, swimlaneId} = await bootBoard(
			'01EVENTLOGWATCH00000000005',
		);

		// Resolves the gitdir now, so the pass below does not wait on a
		// subprocess that could outlast the load.
		await reloadIfEventLogMoved();

		appendFromAnotherProcess(stateBranchRoot, swimlaneId, 'mid-open');

		// Where `:open` stands between moving cwd and `loadProject` finishing.
		const loading = loadProject(repoRoot);

		const skipped = await reloadIfEventLogMoved();
		expect(skipped.message).toBe('Project loading');

		const loaded = await loading;
		expect(isFail(loaded)).toBe(false);
	});

	it('keeps watching after a replay that found no project', async () => {
		const {stateBranchRoot, swimlaneId} = await bootBoard(
			'01EVENTLOGWATCH00000000007',
		);

		// What `bootStateFromEventLog` leaves after replaying an empty log.
		patchState({hasProjectDefinition: false});

		appendFromAnotherProcess(
			stateBranchRoot,
			swimlaneId,
			'after an empty read',
		);

		const moved = await reloadIfEventLogMoved();
		expect(isFail(moved)).toBe(false);
		expect(titles()).toContain('after an empty read');
	});
});
