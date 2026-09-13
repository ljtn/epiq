import {describe, expect, it} from 'vitest';
import {coreCall, coreCallJson} from '../lib/native/core.js';
import {isFail} from '../lib/model/result-types.js';

type Pong = {pong: string; bytes: number};

describe('epiq-core wasm boundary', () => {
	it('round-trips a string through the module', () => {
		const result = coreCallJson<Pong>('ping', 'hello, core');

		expect(isFail(result)).toBe(false);
		expect(result.value).toEqual({pong: 'hello, core', bytes: 11});
	});

	it('carries a payload large enough to grow the memory', () => {
		// Well past the module's initial pages, so the buffer detaches at least
		// once between the allocation and the copy out.
		const big = 'x'.repeat(6 * 1024 * 1024);
		const result = coreCallJson<Pong>('ping', big);

		expect(isFail(result)).toBe(false);
		expect(result.value?.bytes).toBe(big.length);
		expect(result.value?.pong.length).toBe(big.length);
	});

	it('carries an empty input', () => {
		const result = coreCallJson<Pong>('ping', new Uint8Array());

		expect(isFail(result)).toBe(false);
		expect(result.value).toEqual({pong: '', bytes: 0});
	});

	it('turns an error document into a failed Result, and keeps working after', () => {
		const unknown = coreCallJson('no-such-op', '');

		expect(isFail(unknown)).toBe(true);
		expect(unknown.message).toContain('unknown op: no-such-op');

		const next = coreCall('ping', 'still here');
		expect(isFail(next)).toBe(false);
	});
});
