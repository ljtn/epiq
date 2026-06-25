import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';

import {parsePeekArgs} from '../lib/command-line/validate-date.js';

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(() => ({replay: null})),
	patchState: vi.fn(),
}));

vi.mock('../lib/event/event-materialize.js', () => ({
	materialize: vi.fn(() => ({status: 'success', message: 'ok', value: {}})),
	getAffectedNodeIds: vi.fn(() => []),
}));

vi.mock('../lib/event/format-log-utils.js', () => ({
	describeEvent: vi.fn(() => 'Created with title "x"'),
}));

import {patchState} from '../lib/state/state.js';
import {materialize} from '../lib/event/event-materialize.js';
import {
	cancelActiveReplay,
	isReplayActive,
	startReplay,
} from '../lib/command-line/commands/peek-replay.js';

describe('parsePeekArgs', () => {
	it('separates an offset modifier from the play keyword', () => {
		expect(parsePeekArgs('2y', 'play')).toEqual({
			dateInput: '2y',
			isReplay: true,
		});
	});

	it('strips a trailing play keyword from an absolute date inputString', () => {
		expect(parsePeekArgs('', '2024-01-01 play')).toEqual({
			dateInput: '2024-01-01',
			isReplay: true,
		});
	});

	it('keeps an absolute date with time intact when replaying', () => {
		expect(parsePeekArgs('', '2024-01-01 14:30 play')).toEqual({
			dateInput: '2024-01-01 14:30',
			isReplay: true,
		});
	});

	it('reports no replay when play is absent', () => {
		expect(parsePeekArgs('', '2024-01-01')).toEqual({
			dateInput: '2024-01-01',
			isReplay: false,
		});
	});

	it('tolerates a missing inputString', () => {
		expect(parsePeekArgs('now', undefined as unknown as string)).toEqual({
			dateInput: 'now',
			isReplay: false,
		});
	});
});

describe('startReplay', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		cancelActiveReplay();
		vi.useRealTimers();
	});

	it('applies every event forward and finishes live', () => {
		const events = [ulid(1000), ulid(2000), ulid(3000)].map(id => ({
			id,
			action: 'add.board',
			payload: {},
			userId: 'u',
			userName: 'n',
		}));

		startReplay({events: events as never, startTime: 500});

		// Initial patch sets up read-only replay mode.
		expect(patchState).toHaveBeenCalledWith(
			expect.objectContaining({
				timeMode: 'replay',
				readOnly: true,
				replay: expect.objectContaining({appliedCount: 0, totalCount: 3}),
			}),
		);
		expect(isReplayActive()).toBe(true);

		// Slightly past the full window: 60 frames at a rounded interval run a touch
		// longer than the nominal 10s, so give the final frame room to land.
		vi.advanceTimersByTime(11_000);

		expect(materialize).toHaveBeenCalledTimes(3);
		expect(isReplayActive()).toBe(false);

		// Final patch returns to a live, editable board.
		expect(patchState).toHaveBeenLastCalledWith({
			mode: 'default',
			readOnly: false,
			timeMode: 'live',
			unappliedEvents: [],
			replay: null,
		});
	});

	it('aborts the movie to live if an event fails to re-apply', () => {
		vi.mocked(materialize).mockReturnValueOnce({
			status: 'fail',
			message: 'boom',
		} as never);

		const events = [ulid(1000), ulid(2000)].map(id => ({
			id,
			action: 'add.board',
			payload: {},
			userId: 'u',
			userName: 'n',
		}));

		startReplay({events: events as never, startTime: 500});
		vi.advanceTimersByTime(10_000);

		expect(isReplayActive()).toBe(false);
		expect(patchState).toHaveBeenLastCalledWith(
			expect.objectContaining({timeMode: 'live', replay: null}),
		);
	});

	it('cancelActiveReplay halts further materialization', () => {
		const events = Array.from({length: 60}, (_, i) => ({
			id: ulid(1000 + i),
			action: 'add.board',
			payload: {},
			userId: 'u',
			userName: 'n',
		}));

		startReplay({events: events as never, startTime: 500});
		vi.advanceTimersByTime(200);

		const callsBefore = vi.mocked(materialize).mock.calls.length;
		cancelActiveReplay();
		vi.advanceTimersByTime(10_000);

		expect(vi.mocked(materialize).mock.calls.length).toBe(callsBefore);
		expect(isReplayActive()).toBe(false);
	});
});
