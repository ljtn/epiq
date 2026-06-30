import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';

import {
	parseReplayArgs,
	parseReplayDuration,
} from '../lib/command-line/validate-date.js';

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
} from '../lib/command-line/commands/replay-engine.js';

describe('parseReplayArgs', () => {
	it('reads an offset modifier with no duration', () => {
		expect(parseReplayArgs('2y', '')).toEqual({
			dateInput: '2y',
			durationInput: '',
		});
	});

	it('peels a trailing duration off an offset modifier', () => {
		expect(parseReplayArgs('2y', '30s')).toEqual({
			dateInput: '2y',
			durationInput: '30s',
		});
	});

	it('reads an absolute date from inputString with no duration', () => {
		expect(parseReplayArgs('', '2024-01-01')).toEqual({
			dateInput: '2024-01-01',
			durationInput: '',
		});
	});

	it('keeps an absolute date with a space-separated time intact', () => {
		expect(parseReplayArgs('', '2024-01-01 14:30')).toEqual({
			dateInput: '2024-01-01 14:30',
			durationInput: '',
		});
	});

	it('peels a duration off an absolute date with a time', () => {
		expect(parseReplayArgs('', '2024-01-01 14:30 30s')).toEqual({
			dateInput: '2024-01-01 14:30',
			durationInput: '30s',
		});
	});

	it('treats a trailing bare number as a duration', () => {
		expect(parseReplayArgs('', '2024-01-01 45')).toEqual({
			dateInput: '2024-01-01',
			durationInput: '45',
		});
	});

	it('tolerates a missing inputString', () => {
		expect(parseReplayArgs('2y', undefined as unknown as string)).toEqual({
			dateInput: '2y',
			durationInput: '',
		});
	});
});

describe('parseReplayDuration', () => {
	it('reads seconds with an s suffix', () => {
		expect(parseReplayDuration('30s')).toBe(30_000);
	});

	it('reads minutes with an m suffix', () => {
		expect(parseReplayDuration('2m')).toBe(120_000);
	});

	it('treats a bare number as seconds', () => {
		expect(parseReplayDuration('45')).toBe(45_000);
	});

	it('rejects zero, negatives, and nonsense', () => {
		expect(parseReplayDuration('0s')).toBeNull();
		expect(parseReplayDuration('-5s')).toBeNull();
		expect(parseReplayDuration('soon')).toBeNull();
		expect(parseReplayDuration('')).toBeNull();
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

		startReplay({events: events as never, startTime: 500, durationMs: 10_000});

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
			selectedIndex: 0,
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

		startReplay({events: events as never, startTime: 500, durationMs: 10_000});
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

		startReplay({events: events as never, startTime: 500, durationMs: 10_000});
		vi.advanceTimersByTime(200);

		const callsBefore = vi.mocked(materialize).mock.calls.length;
		cancelActiveReplay();
		vi.advanceTimersByTime(10_000);

		expect(vi.mocked(materialize).mock.calls.length).toBe(callsBefore);
		expect(isReplayActive()).toBe(false);
	});
});
