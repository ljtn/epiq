import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {startPacedWatch} from '../lib/utils/paced-watch.js';

beforeEach(() => {
	vi.useFakeTimers();
	(globalThis as {logger?: unknown}).logger = {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	};
});

afterEach(() => {
	vi.useRealTimers();
});

describe('startPacedWatch', () => {
	it('checks once per interval until stopped', async () => {
		const check = vi.fn(async () => {});
		const stop = startPacedWatch(check, 1_000);

		await vi.advanceTimersByTimeAsync(3_000);
		expect(check).toHaveBeenCalledTimes(3);

		stop();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(check).toHaveBeenCalledTimes(3);
	});

	it('pauses at least as long as the last check took', async () => {
		const check = vi.fn(
			() => new Promise<void>(resolve => setTimeout(resolve, 2_500)),
		);
		const stop = startPacedWatch(check, 1_000);

		// Starts at 1s, runs until 3.5s, so the next one is due at 6s.
		await vi.advanceTimersByTimeAsync(5_999);
		expect(check).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(check).toHaveBeenCalledTimes(2);

		stop();
	});

	it('keeps watching after a check throws', async () => {
		const check = vi
			.fn(async () => {})
			.mockRejectedValueOnce(new Error('boom'));
		const stop = startPacedWatch(check, 1_000);

		await vi.advanceTimersByTimeAsync(2_000);
		expect(check).toHaveBeenCalledTimes(2);
		expect(logger.error).toHaveBeenCalledOnce();

		stop();
	});
});
