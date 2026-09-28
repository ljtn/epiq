import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {getWorktreesRoot} from '../git/git-storage.js';
import {succeeded} from '../lib/model/result-types.js';

// A TUI or an agent's MCP appends to the worktree this GUI serves. With
// autosync off, this watch is the only thing that tells the clients.

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-log-watch-'));
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

const getGuiStateMock = vi.fn();
const broadcastMock = vi.fn();
let timeMode = 'live';
let syncLocked = false;

vi.mock('../mcp/epiq-api.js', () => ({
	getGuiState: (...args: unknown[]) => getGuiStateMock(...args),
}));

vi.mock('../mcp/epiq-time-travel.js', () => ({
	getTimeTravelStatus: () => ({mode: timeMode}),
	runExclusive: (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../gui/client/lib/gui-broadcast.js', () => ({
	broadcastGuiMessage: (...args: unknown[]) => broadcastMock(...args),
}));

vi.mock('../gui/api/lib/slim-state.js', () => ({
	slimStateResult: (result: unknown) => result,
}));

vi.mock('../git/sync-lock.js', () => ({
	isSyncLockHeldAt: async () => syncLocked,
}));

const {createLogPublisher, startGuiLogWatch} = await import(
	'../gui/api/lib/api-log-watch.js'
);

const appendEvent = (file: string) =>
	fs.appendFileSync(path.join(eventsDir, file), '{"v":1}\n');

// Several passes of a 5ms watch.
const tick = () => new Promise(resolve => setTimeout(resolve, 40));

let stop: (() => void) | null = null;

const start = () => {
	stop = startGuiLogWatch(createLogPublisher({project: {repoRoot}}), 5);
};

beforeEach(() => {
	fs.rmSync(eventsDir, {recursive: true, force: true});
	fs.mkdirSync(eventsDir, {recursive: true});
	appendEvent('jo.jsonl');
	getGuiStateMock.mockReset();
	getGuiStateMock.mockResolvedValue(succeeded('state', {boards: []}));
	broadcastMock.mockReset();
	timeMode = 'live';
	syncLocked = false;
});

afterEach(() => {
	stop?.();
	stop = null;
});

describe('GUI log watch', () => {
	it('publishes another process’s write with no sync at all', async () => {
		start();
		await tick();
		expect(broadcastMock).not.toHaveBeenCalled();

		appendEvent('claude-peter~pending.jsonl');

		await vi.waitFor(() => expect(broadcastMock).toHaveBeenCalledTimes(1));
		expect(broadcastMock.mock.calls[0]?.[0]).toMatchObject({type: 'state'});
	});

	it('publishes each change once, not on every pass', async () => {
		start();
		appendEvent('claude-peter~pending.jsonl');
		await vi.waitFor(() => expect(broadcastMock).toHaveBeenCalledTimes(1));

		// Several more passes over the same log.
		await tick();
		await tick();

		expect(getGuiStateMock).toHaveBeenCalledTimes(1);
		expect(broadcastMock).toHaveBeenCalledTimes(1);
	});

	it('waits while a live process syncs the worktree', async () => {
		syncLocked = true;
		start();
		appendEvent('claude-peter~pending.jsonl');
		await tick();

		expect(getGuiStateMock).not.toHaveBeenCalled();

		syncLocked = false;

		await vi.waitFor(() => expect(broadcastMock).toHaveBeenCalledTimes(1));
	});

	it('leaves a board in the past alone, and catches up on return', async () => {
		timeMode = 'peek';
		start();
		appendEvent('claude-peter~pending.jsonl');
		await tick();

		expect(getGuiStateMock).not.toHaveBeenCalled();

		timeMode = 'live';

		await vi.waitFor(() => expect(broadcastMock).toHaveBeenCalledTimes(1));
	});

	it('stops publishing once stopped', async () => {
		start();
		stop?.();
		appendEvent('claude-peter~pending.jsonl');
		await tick();

		expect(broadcastMock).not.toHaveBeenCalled();
	});
});
