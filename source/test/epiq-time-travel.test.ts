import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';

vi.mock('../git/git-storage.js', () => ({
	getStateBranchRoot: vi.fn(),
}));

vi.mock('../lib/storage/paths.js', () => ({
	resolveClosestEpiqProjectRoot: vi.fn(),
}));

vi.mock('../lib/event/event-load.js', () => ({
	loadMergedEvents: vi.fn(),
	loadMergedEventsBefore: vi.fn(),
}));

vi.mock('../lib/event/event-materialize.js', () => ({
	materializeAll: vi.fn(),
}));

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(),
	isStateInitialized: vi.fn(),
	patchState: vi.fn(),
	resetState: vi.fn(),
}));

import {getStateBranchRoot} from '../git/git-storage.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../lib/event/event-load.js';
import {materializeAll} from '../lib/event/event-materialize.js';
import {
	getState,
	isStateInitialized,
	patchState,
	resetState,
} from '../lib/state/state.js';
import {failed, isFail, isSuccess, succeeded} from '../lib/model/result-types.js';
import {
	checkoutStateAt,
	getEventTimeline,
	getTimeTravelStatus,
	returnToLive,
	runExclusive,
} from '../mcp/epiq-time-travel.js';

describe('epiq-time-travel', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		vi.mocked(resolveClosestEpiqProjectRoot).mockReturnValue(
			succeeded('root', '/repo'),
		);

		vi.mocked(getStateBranchRoot).mockReturnValue(
			succeeded('branch', '/repo/.epiq'),
		);

		vi.mocked(resetState).mockReturnValue(succeeded('reset', ''));
		vi.mocked(materializeAll).mockReturnValue([]);
	});

	describe('getTimeTravelStatus', () => {
		it('reports live when state is uninitialized', () => {
			vi.mocked(isStateInitialized).mockReturnValue(false);

			expect(getTimeTravelStatus()).toEqual({mode: 'live', asOfTime: null});
		});

		it('reports live when timeMode is live', () => {
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'live'} as never);

			expect(getTimeTravelStatus()).toEqual({mode: 'live', asOfTime: null});
		});

		it('reports scrub with the checked-out time after a successful checkout', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [{id: '2'}],
				} as never),
			);

			await checkoutStateAt({targetTime: 5000});

			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'peek'} as never);

			expect(getTimeTravelStatus()).toEqual({mode: 'scrub', asOfTime: 5000});
		});
	});

	describe('getEventTimeline', () => {
		it('returns an empty timeline when there is no event history', async () => {
			vi.mocked(loadMergedEvents).mockReturnValue(succeeded('events', []));

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.buckets).toEqual([]);
		});

		it('buckets event timestamps decoded from their ULIDs', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{id: ulid(baseTime)},
				{id: ulid(baseTime)},
				{id: ulid(baseTime + 60_000)},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.earliest).toBe(baseTime);
			const totalCount = result.value.buckets.reduce(
				(sum, bucket) => sum + bucket.count,
				0,
			);
			expect(totalCount).toBe(3);
		});

		it('scopes to an explicit start/end window, excluding events outside it', async () => {
			const baseTime = 1_700_000_000_000;
			const dayMs = 24 * 60 * 60 * 1000;
			const events = [
				{id: ulid(baseTime - dayMs)}, // before the window
				{id: ulid(baseTime + dayMs)}, // inside the window
				{id: ulid(baseTime + 10 * dayMs)}, // after the window
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const windowStart = baseTime;
			const windowEnd = baseTime + 3 * dayMs;

			const result = await getEventTimeline({
				start: windowStart,
				end: windowEnd,
			});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.earliest).toBe(windowStart);
			expect(result.value.latest).toBe(windowEnd);

			const totalCount = result.value.buckets.reduce(
				(sum, bucket) => sum + bucket.count,
				0,
			);
			expect(totalCount).toBe(1);
		});

		it('propagates a failure to load events', async () => {
			vi.mocked(loadMergedEvents).mockReturnValue(failed('boom'));

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(false);
		});
	});

	describe('checkoutStateAt', () => {
		it('materializes events before the target time and marks state read-only', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [{id: '2'}],
				} as never),
			);

			const result = await checkoutStateAt({targetTime: 1234});

			expect(loadMergedEventsBefore).toHaveBeenCalledWith('/repo/.epiq', 1234);
			expect(resetState).toHaveBeenCalled();
			expect(materializeAll).toHaveBeenCalledWith([{id: '1'}]);

			expect(patchState).toHaveBeenCalledWith({
				readOnly: true,
				timeMode: 'peek',
				unappliedEvents: [{id: '2'}],
				replay: null,
			});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(result.value.asOfTime).toBe(1234);
		});

		it('fails without patching state when materialization fails', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [],
				} as never),
			);

			vi.mocked(materializeAll).mockReturnValue([failed('boom')]);

			const result = await checkoutStateAt({targetTime: 1234});

			expect(isSuccess(result)).toBe(false);
			expect(patchState).not.toHaveBeenCalled();
		});
	});

	describe('returnToLive', () => {
		it('re-materializes the full event log and marks state live', async () => {
			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', [{id: '1'}, {id: '2'}] as never),
			);

			const result = await returnToLive();

			expect(materializeAll).toHaveBeenCalledWith([{id: '1'}, {id: '2'}]);

			expect(patchState).toHaveBeenCalledWith({
				readOnly: false,
				timeMode: 'live',
				unappliedEvents: [],
				replay: null,
			});

			expect(isSuccess(result)).toBe(true);
		});

		it('clears the tracked as-of time so status reports live again', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [],
					unappliedEvents: [],
				} as never),
			);
			await checkoutStateAt({targetTime: 999});

			vi.mocked(loadMergedEvents).mockReturnValue(succeeded('events', []));
			await returnToLive();

			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'live'} as never);

			expect(getTimeTravelStatus()).toEqual({mode: 'live', asOfTime: null});
		});
	});

	describe('runExclusive', () => {
		it('serializes overlapping operations instead of running them concurrently', async () => {
			const log: string[] = [];

			const first = runExclusive(async () => {
				log.push('first:start');
				await new Promise(resolve => setTimeout(resolve, 20));
				log.push('first:end');
			});

			// Queued while `first` is still in flight — must not start early.
			const second = runExclusive(async () => {
				log.push('second:start');
				log.push('second:end');
			});

			await Promise.all([first, second]);

			expect(log).toEqual([
				'first:start',
				'first:end',
				'second:start',
				'second:end',
			]);
		});

		it('still runs a queued operation after an earlier one rejects', async () => {
			const first = runExclusive(async () => {
				throw new Error('boom');
			});

			let secondRan = false;
			const second = runExclusive(async () => {
				secondRan = true;
			});

			await expect(first).rejects.toThrow('boom');
			await second;

			expect(secondRan).toBe(true);
		});

		// Reproduces the reported bug: a scrub landing mid-sync must not be
		// clobbered by that sync's post-await state refresh. checkoutStateAt
		// and returnToLive share this same lock with the autosync tick
		// (api-autosync.ts), so a "sync" queued first must fully finish —
		// including everything after its own await — before a queued checkout
		// gets to run, and vice versa.
		it("a checkout queued during an in-flight exclusive op waits for it, so it can't be clobbered", async () => {
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'live'} as never);

			const log: string[] = [];
			let releaseSync: () => void = () => {};
			const syncGate = new Promise<void>(resolve => {
				releaseSync = resolve;
			});

			const fakeAutosyncTick = runExclusive(async () => {
				log.push('sync:start');
				await syncGate; // simulates the git round-trip
				log.push('sync:end');
			});

			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [],
				} as never),
			);

			const checkout = checkoutStateAt({targetTime: 1234}).then(result => {
				log.push('checkout:done');
				return result;
			});

			// Give the checkout every chance to (wrongly) run early.
			await new Promise(resolve => setTimeout(resolve, 10));
			expect(log).toEqual(['sync:start']);
			expect(patchState).not.toHaveBeenCalled();

			releaseSync();
			await fakeAutosyncTick;
			const result = await checkout;

			expect(log).toEqual(['sync:start', 'sync:end', 'checkout:done']);
			expect(isSuccess(result)).toBe(true);
		});
	});
});
