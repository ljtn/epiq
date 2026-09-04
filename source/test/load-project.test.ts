import fs from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ensureLocalStateBranch} from '../git/git.js';
import {execGit} from '../git/git-utils.js';
import {syncEpiqWithRemote} from '../git/sync.js';
import {
	loadProject,
	loadWithoutProject,
	refreshProjectFromRemote,
} from '../lib/boot/load-project.js';
import {ACTOR_NAME_ENV} from '../lib/config/actor-env.js';
import {
	listRecentProjects,
	readRecentProjects,
} from '../lib/config/recent-projects.js';
import {createDefaultEvents} from '../lib/event/event-boot.js';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {getPersistFileName} from '../lib/event/event-persist.js';
import {AppEvent} from '../lib/event/event.model.js';
import {isFail} from '../lib/model/result-types.js';
import {DEFAULT_STATE_BRANCH} from '../lib/project-setup/project-setup.js';
import {getState} from '../lib/state/state.js';
import {
	assumeActor,
	createIssue,
	listBoards,
	listSwimlanes,
} from '../mcp/epiq-api.js';
import {
	cloneRepo,
	makeTempDir,
	setupRepo,
	useTempHome,
	writeProjectFile,
} from './helpers/git-repo.js';

const git = async (cwd: string, args: string[]) => {
	const result = await execGit({cwd, args});
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

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
});

describe('loadProject', () => {
	it('records the project it booted as the most recent', async () => {
		const repoRoot = await makeRepo('01LOADPROJECT0000000000001');

		const result = await loadProject(repoRoot);

		expect(isFail(result)).toBe(false);
		const recent = listRecentProjects();
		expect(!isFail(recent) && recent.value.map(entry => entry.root)).toEqual([
			repoRoot,
		]);
		expect(getState().hasProjectDefinition).toBe(true);
	});

	it('keeps earlier projects behind the one just booted', async () => {
		const first = await makeRepo('01LOADPROJECT0000000000002');
		const second = await makeRepo('01LOADPROJECT0000000000003');

		await loadProject(first);
		await loadProject(second);

		const recent = listRecentProjects();
		expect(!isFail(recent) && recent.value.map(entry => entry.root)).toEqual([
			second,
			first,
		]);
	});

	it('does not record a project that failed to load', async () => {
		const notARepo = path.join(makeTempDir(), 'plain');
		fs.mkdirSync(path.join(notARepo, '.epiq'), {recursive: true});
		fs.writeFileSync(
			path.join(notARepo, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: '01LOADPROJECT0000000000004',
				stateBranch: DEFAULT_STATE_BRANCH,
				createdAt: new Date().toISOString(),
			}),
		);

		const result = await loadProject(notARepo);

		expect(isFail(result)).toBe(true);
		const recorded = readRecentProjects();
		expect(!isFail(recorded) && recorded.value).toEqual([]);
	});
});

// Two clones of one remote: alice writes, bob boots. Alice's writes go through
// the same API the MCP uses, so bob replays real events, not hand-made lines.
const seedRemote = async () => {
	const {remoteRoot, repoRoot: alice} = await setupRepo();

	const assumed = await assumeActor({repoRoot: alice, name: 'alice'});
	if (isFail(assumed)) throw new Error(assumed.message);

	const ownEventFileName = getPersistFileName(assumed.value);

	const sync = () => syncEpiqWithRemote({cwd: alice, ownEventFileName});

	const bootstrapped = await sync();
	if (isFail(bootstrapped)) throw new Error(bootstrapped.message);

	const bob = makeTempDir();
	await cloneRepo({remoteRoot, cloneRoot: bob});
	writeProjectFile(bob);

	const seedBoard = async () => {
		const defaults = createDefaultEvents(assumed.value);
		if (isFail(defaults)) throw new Error(defaults.message);

		const seeded = materializeAndPersistAll(
			[...defaults.value] as AppEvent[],
			bootstrapped.value.stateBranchRoot,
		);
		if (isFail(seeded)) throw new Error(seeded.message);

		const pushed = await sync();
		if (isFail(pushed)) throw new Error(pushed.message);
	};

	const writeIssue = async (title: string) => {
		const boards = await listBoards({repoRoot: alice});
		if (isFail(boards)) throw new Error(boards.message);

		const swimlanes = await listSwimlanes({
			repoRoot: alice,
			boardId: boards.value[0]!.id,
		});
		if (isFail(swimlanes)) throw new Error(swimlanes.message);

		const created = await createIssue({
			repoRoot: alice,
			title,
			parentId: swimlanes.value[0]!.id,
		});
		if (isFail(created)) throw new Error(created.message);

		const pushed = await sync();
		if (isFail(pushed)) throw new Error(pushed.message);
	};

	const bobSync = async () => {
		const result = await syncEpiqWithRemote({
			cwd: bob,
			ownEventFileName: 'u2.bob.jsonl',
		});
		if (isFail(result)) throw new Error(result.message);
	};

	return {bob, seedBoard, writeIssue, bobSync};
};

const titles = () => Object.values(getState().nodes).map(node => node.title);

describe('loadProject against a remote', () => {
	const originalCwd = process.cwd();

	afterEach(() => {
		process.chdir(originalCwd);
		delete process.env[ACTOR_NAME_ENV];
	});

	it('boots from the local log and picks the remote up afterwards', async () => {
		const {bob, seedBoard, writeIssue, bobSync} = await seedRemote();
		await seedBoard();
		await bobSync();
		await writeIssue('written after boot');
		process.chdir(bob);

		const loaded = await loadProject(bob);
		if (isFail(loaded)) throw new Error(loaded.message);

		expect(titles()).not.toContain('written after boot');

		const refreshed = await refreshProjectFromRemote(bob);
		if (isFail(refreshed)) throw new Error(refreshed.message);

		expect(titles()).toContain('written after boot');
		expect(getState().syncStatus).toEqual({status: 'synced', msg: 'Pulled'});

		const again = await refreshProjectFromRemote(bob);
		if (isFail(again)) throw new Error(again.message);

		expect(getState().syncStatus.msg).toBe('Already synced');
	});

	it('leaves the board alone when the project changed during the pull', async () => {
		const {bob, seedBoard, writeIssue, bobSync} = await seedRemote();
		await seedBoard();
		await bobSync();
		await writeIssue('written after boot');

		const loaded = await loadProject(bob);
		if (isFail(loaded)) throw new Error(loaded.message);

		// Somewhere that is not bob's project, as after an `:open` elsewhere.
		process.chdir(makeTempDir());

		const refreshed = await refreshProjectFromRemote(bob);
		if (isFail(refreshed)) throw new Error(refreshed.message);

		expect(refreshed.message).toBe('Project changed during the pull');
		expect(titles()).not.toContain('written after boot');
	});

	it('does not flag a board the remote has never seen', async () => {
		// An origin, but the state branch exists only locally: never synced.
		const {repoRoot} = await setupRepo();
		const branch = await ensureLocalStateBranch({
			repoRoot,
			stateBranchName: DEFAULT_STATE_BRANCH,
		});
		if (isFail(branch)) throw new Error(branch.message);
		process.chdir(repoRoot);

		const loaded = await loadProject(repoRoot);
		if (isFail(loaded)) throw new Error(loaded.message);

		const refreshed = await refreshProjectFromRemote(repoRoot);
		if (isFail(refreshed)) throw new Error(refreshed.message);

		expect(getState().syncStatus.status).toBe('synced');
	});

	it('pulls first when there is no local log to boot from', async () => {
		const {bob, seedBoard, bobSync} = await seedRemote();
		await bobSync();
		await seedBoard();

		const loaded = await loadProject(bob);
		if (isFail(loaded)) throw new Error(loaded.message);

		expect(getState().hasInitializingEvents).toBe(true);
	});
});

describe('loadWithoutProject', () => {
	it('boots the placeholder workspace and records nothing', () => {
		const result = loadWithoutProject();

		expect(isFail(result)).toBe(false);
		expect(getState().hasProjectDefinition).toBe(false);
		const recorded = readRecentProjects();
		expect(!isFail(recorded) && recorded.value).toEqual([]);
	});
});
