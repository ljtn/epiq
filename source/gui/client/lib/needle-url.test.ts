import {describe, expect, it} from 'vitest';
import {readNeedleParam, writeNeedleParam} from './needle-url';

describe('the needle in the URL', () => {
	it('round-trips a parked moment', () => {
		const params = new URLSearchParams('scope=week');
		writeNeedleParam(params, 1_790_000_000_123.4);

		expect(params.toString()).toBe('scope=week&at=1790000000123');
		expect(readNeedleParam(params)).toBe(1_790_000_000_123);
	});

	it('leaves live off the URL', () => {
		const params = new URLSearchParams('at=5&scope=week');
		writeNeedleParam(params, null);

		expect(params.toString()).toBe('scope=week');
		expect(readNeedleParam(params)).toBeNull();
	});

	it('reads a malformed moment as none', () => {
		for (const raw of ['', 'abc', '-5', '1e3', '12.5', '9'.repeat(30)]) {
			expect(readNeedleParam(new URLSearchParams({at: raw}))).toBeNull();
		}
	});
});
