import {beforeEach, describe, expect, it, vi} from 'vitest';

const syncEpiqWithRemote = vi.hoisted(() => vi.fn());

vi.mock('../git/sync.js', () => ({syncEpiqWithRemote}));
vi.mock('../lib/board/board-log.js', async importOriginal => ({
	...(await importOriginal<object>()),
	resolveActorId: () => ({
		status: 'success',
		message: '',
		value: {userId: 'u1', userName: 'alice'},
	}),
}));

vi.mock('../mcp/api/boot.js', async importOriginal => ({
	...(await importOriginal<object>()),
	getActor: () => ({
		status: 'success',
		message: '',
		value: {userId: 'u1', userName: 'alice'},
	}),
	resolveRepoRoot: (repoRoot: string) => ({
		status: 'success',
		message: '',
		value: repoRoot,
	}),
}));

import {syncAndReloadState} from '../git/sync-and-reload-state.js';
import {loadWithoutProject} from '../lib/boot/load-project.js';
import {syncCommand} from '../lib/command-line/commands/sync.cmd.js';
import {isFail} from '../lib/model/result-types.js';
import {getState} from '../lib/state/state.js';
import {setSyncOffline} from '../lib/state/sync-state.js';
import {sync} from '../mcp/api/state.js';
import {makeTempDir} from './helpers/git-repo.js';

beforeEach(() => {
	(globalThis as {logger?: unknown}).logger = {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	};

	syncEpiqWithRemote.mockReset();
	loadWithoutProject();
});

describe('syncAndReloadState when the sync throws', () => {
	it('fails every caller, including one that joined, and frees the pill', async () => {
		syncEpiqWithRemote.mockImplementation(async () => {
			await new Promise(resolve => setTimeout(resolve, 10));
			throw new Error('sync threw');
		});

		const owner = syncAndReloadState();
		const joiner = syncAndReloadState();

		const results = await Promise.allSettled([owner, joiner]);

		for (const settled of results) {
			expect(settled.status).toBe('fulfilled');
			if (settled.status === 'fulfilled') {
				expect(isFail(settled.value)).toBe(true);
				expect(settled.value.message).toBe('sync threw');
			}
		}

		// `isSyncing()` keys on this; left at 'syncing', no sync runs again.
		expect(getState().syncStatus.status).toBe('failed');
	});
});

describe('a sync that reached no remote', () => {
	const notPublished = () => {
		const root = makeTempDir();

		syncEpiqWithRemote.mockImplementation(async () => {
			setSyncOffline('Not published');

			return {
				status: 'success',
				message: 'Not published',
				value: {offline: true, repoRoot: root, stateBranchRoot: root},
			};
		});

		return root;
	};

	it('says why on the TUI', async () => {
		notPublished();

		expect(isFail(await syncAndReloadState())).toBe(false);
		expect(getState().syncStatus).toEqual({
			msg: 'Not published',
			status: 'offline',
		});
	});

	it('says why on the sync command', async () => {
		notPublished();

		expect(isFail(await syncCommand())).toBe(false);
		expect(getState().syncStatus).toEqual({
			msg: 'Not published',
			status: 'offline',
		});
	});

	it('is not called synced on the GUI and MCP path', async () => {
		const repoRoot = notPublished();

		const result = await sync({repoRoot});
		expect(isFail(result)).toBe(false);
		expect(result.message).toBe('Not published');
		expect(getState().syncStatus).toEqual({
			msg: 'Not published',
			status: 'offline',
		});
	});
});
