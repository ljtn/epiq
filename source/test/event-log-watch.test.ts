import fs from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';
import {reloadIfEventLogMoved} from '../git/event-log-watch.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {execGit} from '../git/git-utils.js';
import {ensureLocalStateBranch} from '../git/git.js';
import {loadProject, loadWithoutProject} from '../lib/boot/load-project.js';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {materializeAndPersistAll} from '../lib/board/board-log.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {clearAccountedSignature} from '../lib/event/log-signature.js';
import {NavNodeCtx} from '../lib/model/context.model.js';
import {isFail} from '../lib/model/result-types.js';
import {DEFAULT_STATE_BRANCH} from '../lib/project-setup/project-setup.js';
import {getState} from '../lib/state/state.js';
import {getEventsDirPath} from '../lib/storage/paths.js';
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
		const repoRoot = await makeRepo('01EVENTLOGWATCH00000000001');

		const stateBranchRootResult = getStateBranchRoot({repoRoot});
		if (isFail(stateBranchRootResult)) {
			throw new Error(stateBranchRootResult.message);
		}
		const stateBranchRoot = stateBranchRootResult.value;

		loadWithoutProject();
		process.chdir(repoRoot);

		// First boot puts the worktree in place; the seed can only persist
		// into one that exists.
		const bootstrapped = await loadProject(repoRoot);
		if (isFail(bootstrapped)) throw new Error(bootstrapped.message);

		// A board the TUI's boot can land on: seeded the way a first sync
		// would leave it, through the real persister.
		const defaults = createDefaultEvents({userId: 'seed', userName: 'seed'});
		if (isFail(defaults)) throw new Error(defaults.message);

		const seeded = materializeAndPersistAll(
			[...defaults.value] as AppEvent[],
			stateBranchRoot,
		);
		if (isFail(seeded)) throw new Error(seeded.message);

		const loaded = await loadProject(repoRoot);
		if (isFail(loaded)) throw new Error(loaded.message);

		const unchanged = reloadIfEventLogMoved();
		expect(unchanged.status).toBe('success');
		expect(unchanged.message).toBe('Log unchanged');

		// What an MCP server in another session does: appends to its own log
		// in the same worktree, with nothing telling this process about it.
		const swimlane = Object.values(getState().nodes).find(
			node => node.context === NavNodeCtx.SWIMLANE,
		);
		if (!swimlane) throw new Error('No swimlane on the seeded board');

		fs.appendFileSync(
			path.join(getEventsDirPath(stateBranchRoot), 'otheractor.jsonl'),
			JSON.stringify({
				v: 1,
				id: [ulid(), null],
				'add.issue': {
					id: ulid(),
					name: 'landed from another process',
					parent: swimlane.id,
					rank: 'a0',
				},
			}) + '\n',
		);

		const moved = reloadIfEventLogMoved();
		expect(isFail(moved)).toBe(false);
		expect(titles()).toContain('landed from another process');

		// Its own reload accounted for the log, so a second pass stays put.
		const again = reloadIfEventLogMoved();
		expect(again.status).toBe('success');
		expect(again.message).toBe('Log unchanged');
	});

	it('does not reload for writes this process made itself', async () => {
		const repoRoot = await makeRepo('01EVENTLOGWATCH00000000002');

		const stateBranchRootResult = getStateBranchRoot({repoRoot});
		if (isFail(stateBranchRootResult)) {
			throw new Error(stateBranchRootResult.message);
		}
		const stateBranchRoot = stateBranchRootResult.value;

		loadWithoutProject();
		process.chdir(repoRoot);

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

		// An append this process applied as it wrote it: `persist` runs
		// `noteOwnAppend`, so the accounted signature moves with the file.
		const swimlane = Object.values(getState().nodes).find(
			node => node.context === NavNodeCtx.SWIMLANE,
		);
		if (!swimlane) throw new Error('No swimlane on the seeded board');

		const own = materializeAndPersistAll(
			[
				{
					id: ulid(),
					userId: 'own-actor',
					action: 'add.issue',
					payload: {
						id: ulid(),
						name: 'written by this process',
						parent: swimlane.id,
						rank: 'a1',
					},
				},
			] as AppEvent[],
			stateBranchRoot,
		);
		if (isFail(own)) throw new Error(own.message);

		const unchanged = reloadIfEventLogMoved();
		expect(unchanged.status).toBe('success');
		expect(unchanged.message).toBe('Log unchanged');
	});
});
