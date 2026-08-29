import {afterEach, describe, expect, it} from 'vitest';
import {MAX_RECONNECT_ATTEMPTS, reconnectDelayMs} from './reconnect';

describe('reconnectDelayMs', () => {
	afterEach(() => {
		delete (globalThis as {window?: unknown}).window;
	});

	it('starts quickly, so a server restart is picked up almost at once', () => {
		expect(reconnectDelayMs(0)).toBe(500);
	});

	it('backs off, so a server that is gone is not hammered', () => {
		const delays = [0, 1, 2, 3].map(reconnectDelayMs) as number[];

		expect(delays).toEqual([...delays].sort((a, b) => a - b));
		expect(new Set(delays).size).toBe(delays.length);
	});

	it('gives up after a few tries, handing over to the button', () => {
		expect(reconnectDelayMs(MAX_RECONNECT_ATTEMPTS - 1)).not.toBeNull();
		expect(reconnectDelayMs(MAX_RECONNECT_ATTEMPTS)).toBeNull();
		expect(reconnectDelayMs(MAX_RECONNECT_ATTEMPTS + 3)).toBeNull();
	});

	it('scales the whole schedule when a test asks it to', () => {
		Object.assign(globalThis, {window: {__epiqReconnectScale: 0.1}});

		expect(reconnectDelayMs(0)).toBe(50);
		expect(reconnectDelayMs(4)).toBe(800);
		expect(reconnectDelayMs(MAX_RECONNECT_ATTEMPTS)).toBeNull();
	});

	it('spends its attempts inside about fifteen seconds', () => {
		const total = Array.from({length: MAX_RECONNECT_ATTEMPTS}, (_, i) =>
			reconnectDelayMs(i),
		).reduce((sum: number, delay) => sum + (delay ?? 0), 0);

		expect(total).toBeLessThan(20_000);
	});
});
