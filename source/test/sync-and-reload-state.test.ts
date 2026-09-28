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

import {syncAndReloadState} from '../git/sync-and-reload-state.js';
import {loadWithoutProject} from '../lib/boot/load-project.js';
import {isFail} from '../lib/model/result-types.js';
import {getState} from '../lib/state/state.js';

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
