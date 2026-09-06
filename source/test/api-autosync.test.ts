import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getWorktreesRoot} from '../git/git-storage.js';
import {failed, succeeded} from '../lib/model/result-types.js';

// The autosync pass is what carries other people's events — and other
// processes' — to every connected GUI. What decides a broadcast is whether the
// log on disk changed, never whether git called the pass a success.

// A real project layout, so the pass resolves the state branch the way the
// server does: project.json under the repo, the worktree under the global dir.
const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-autosync-'));
const projectId = path.basename(repoRoot);
fs.mkdirSync(path.join(repoRoot, '.epiq'));
fs.writeFileSync(
	path.join(repoRoot, '.epiq', 'project.json'),
	JSON.stringify({
		projectId,
		stateBranch: 'epiq/state',
		createdAt: new Date().toISOString(),
	}),
);
const eventsDir = path.join(getWorktreesRoot(), projectId, '.epiq', 'events');

const syncMock = vi.fn();
const getGuiStateMock = vi.fn();
const broadcastMock = vi.fn();

vi.mock('../lib/config/user-config.js', () => ({
	readEpiqConfig: vi.fn(() =>
		succeeded('config', {
			autoSync: true,
			preferredEditor: 'vim',
			userName: 'Jo',
			autoSyncDebounceMs: 1,
		}),
	),
	loadSettingsFromConfig: vi.fn(() => succeeded('settings', {userName: 'Jo'})),
}));

vi.mock('../mcp/epiq-api.js', () => ({
	sync: (...args: unknown[]) => syncMock(...args),
	getGuiState: (...args: unknown[]) => getGuiStateMock(...args),
}));

vi.mock('../mcp/epiq-time-travel.js', () => ({
	getTimeTravelStatus: () => ({mode: 'live'}),
	runExclusive: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../gui/client/lib/gui-broadcast.js', () => ({
	broadcastGuiMessage: (...args: unknown[]) => broadcastMock(...args),
}));

vi.mock('../gui/api/lib/slim-state.js', () => ({
	slimStateResult: (result: unknown) => result,
}));

const {startGuiAutoSync} = await import('../gui/api/lib/api-autosync.js');

const quietSummary = succeeded('Synced', {
	repoRoot,
	stateBranchRoot: path.dirname(path.dirname(eventsDir)),
	createdCommit: false,
	pulled: false,
	pushed: false,
	bootstrapped: false,
	offline: false,
});

const appendEvent = (file = 'jo.jsonl') =>
	fs.appendFileSync(path.join(eventsDir, file), '{"v":1}\n');

// A few passes of the loop: the timer fires after the 1ms debounce.
const tick = () => new Promise(resolve => setTimeout(resolve, 40));

const start = (root = repoRoot) =>
	startGuiAutoSync({project: {repoRoot: root} as never});

let loop: {dispose: () => void} | null = null;

beforeEach(() => {
	fs.rmSync(eventsDir, {recursive: true, force: true});
	fs.mkdirSync(eventsDir, {recursive: true});
	appendEvent();
	syncMock.mockReset();
	syncMock.mockResolvedValue(quietSummary);
	getGuiStateMock.mockReset();
	getGuiStateMock.mockResolvedValue(succeeded('state', {boards: []}));
	broadcastMock.mockReset();
});

afterEach(() => {
	loop?.dispose();
	loop = null;
});

describe('GUI autosync broadcast', () => {
	it('stays quiet when the sync changed nothing', async () => {
		loop = start();
		await tick();

		expect(syncMock).toHaveBeenCalled();
		expect(broadcastMock).not.toHaveBeenCalled();
	});

	it('broadcasts when a failed sync still pulled events in', async () => {
		// A pull that landed, then a push the remote refused: the log has moved
		// and the result says the pass failed.
		syncMock.mockResolvedValue(failed('rejected by remote'));
		syncMock.mockImplementationOnce(async () => {
			appendEvent('teammate.jsonl');
			return failed('rejected by remote');
		});

		loop = start();
		await tick();

		expect(broadcastMock).toHaveBeenCalledTimes(1);
		expect(broadcastMock.mock.calls[0]?.[0]).toMatchObject({type: 'state'});
	});

	it('broadcasts a log another process appended to, even when the sync saw nothing', async () => {
		loop = start();
		appendEvent('claude-peter.jsonl');
		await tick();

		expect(broadcastMock).toHaveBeenCalledTimes(1);
	});

	it('publishes each change once, not on every pass', async () => {
		loop = start();
		appendEvent();
		await tick();
		await tick();
		await tick();

		expect(syncMock.mock.calls.length).toBeGreaterThan(1);
		expect(broadcastMock).toHaveBeenCalledTimes(1);
	});

	// The GUI is often launched from wherever the shell happens to be.
	it('finds the log from a subdirectory of the project', async () => {
		const subdir = path.join(repoRoot, 'src', 'deep');
		fs.mkdirSync(subdir, {recursive: true});

		loop = start(subdir);
		appendEvent('teammate.jsonl');
		await tick();

		expect(broadcastMock).toHaveBeenCalledTimes(1);
	});

	it('does not re-derive a log that failed to derive until it changes again', async () => {
		getGuiStateMock.mockResolvedValue(failed('no workspace init event'));

		loop = start();
		appendEvent('teammate.jsonl');
		await tick();
		await tick();
		await tick();

		expect(syncMock.mock.calls.length).toBeGreaterThan(1);
		expect(getGuiStateMock).toHaveBeenCalledTimes(1);
		expect(broadcastMock).not.toHaveBeenCalled();

		// The log moving is what earns another attempt.
		getGuiStateMock.mockResolvedValue(succeeded('state', {boards: []}));
		appendEvent('teammate.jsonl');
		await tick();

		expect(getGuiStateMock).toHaveBeenCalledTimes(2);
		expect(broadcastMock).toHaveBeenCalledTimes(1);
	});
});
