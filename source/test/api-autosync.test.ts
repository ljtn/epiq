import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {failed, succeeded} from '../lib/model/result-types.js';

// The autosync pass is what carries other people's events — and other
// processes' — to every connected GUI. What decides a broadcast is whether the
// log on disk changed, never whether git called the pass a success.

const stateBranchRoot = fs.mkdtempSync(
	path.join(os.tmpdir(), 'epiq-autosync-'),
);
const eventsDir = path.join(stateBranchRoot, '.epiq', 'events');

const syncMock = vi.fn();
const broadcastMock = vi.fn();

vi.mock('../git/git-storage.js', () => ({
	getStateBranchRoot: vi.fn(() => succeeded('root', stateBranchRoot)),
}));

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
	getGuiState: vi.fn(async () => succeeded('state', {boards: []})),
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
	repoRoot: '/repo',
	stateBranchRoot,
	createdCommit: false,
	pulled: false,
	pushed: false,
	bootstrapped: false,
	offline: false,
});

const appendEvent = (file = 'jo.jsonl') =>
	fs.appendFileSync(path.join(eventsDir, file), '{"v":1}\n');

// One pass of the loop: the timer fires after the 1ms debounce.
const tick = () => new Promise(resolve => setTimeout(resolve, 40));

let loop: {dispose: () => void} | null = null;

beforeEach(() => {
	fs.rmSync(eventsDir, {recursive: true, force: true});
	fs.mkdirSync(eventsDir, {recursive: true});
	appendEvent();
	syncMock.mockReset();
	broadcastMock.mockReset();
});

afterEach(() => {
	loop?.dispose();
	loop = null;
});

describe('GUI autosync broadcast', () => {
	it('stays quiet when the sync changed nothing', async () => {
		syncMock.mockResolvedValue(quietSummary);

		loop = startGuiAutoSync({project: {repoRoot: '/repo'} as never});
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

		loop = startGuiAutoSync({project: {repoRoot: '/repo'} as never});
		await tick();

		expect(broadcastMock).toHaveBeenCalledTimes(1);
		expect(broadcastMock.mock.calls[0]?.[0]).toMatchObject({type: 'state'});
	});

	it('broadcasts a log another process appended to, even when the sync saw nothing', async () => {
		syncMock.mockResolvedValue(quietSummary);

		loop = startGuiAutoSync({project: {repoRoot: '/repo'} as never});
		appendEvent('claude-peter.jsonl');
		await tick();

		expect(broadcastMock).toHaveBeenCalledTimes(1);
	});

	it('publishes each change once, not on every pass', async () => {
		syncMock.mockResolvedValue(quietSummary);

		loop = startGuiAutoSync({project: {repoRoot: '/repo'} as never});
		appendEvent();
		await tick();
		await tick();
		await tick();

		expect(syncMock.mock.calls.length).toBeGreaterThan(1);
		expect(broadcastMock).toHaveBeenCalledTimes(1);
	});
});
