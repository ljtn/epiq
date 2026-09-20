import {describe, expect, it} from 'vitest';
import {sampleGradient} from '../lib/utils/color.js';

// The gradient both sync animations cycle. They each carried their own copy of
// the colour primitives to walk it; these are the colours that walk produced,
// captured before the copies were removed, so the extraction had to match the
// pixels rather than merely compile.
const SYNC_GRADIENT = ['#4c567a', '#9d7cd8', '#7aa2f7', '#7dcfff', '#9d7cd8'];

const TWELFTHS: [number, string][] = [
	[0, '#4c567a'],
	[0.0833, '#676399'],
	[0.1667, '#826fb9'],
	[0.25, '#9d7cd8'],
	[0.3333, '#9189e2'],
	[0.4167, '#8695ed'],
	[0.5, '#7aa2f7'],
	[0.5833, '#7bb1fa'],
	[0.6667, '#7cc0fc'],
	[0.75, '#7dcfff'],
	[0.8333, '#88b3f2'],
	[0.9167, '#9298e5'],
	[1, '#9d7cd8'],
];

describe('sampleGradient', () => {
	it.each(TWELFTHS)('is %s of the way along at %s', (t, expected) => {
		expect(sampleGradient(SYNC_GRADIENT, t)).toBe(expected);
	});

	it('holds at the ends rather than running off them', () => {
		expect(sampleGradient(SYNC_GRADIENT, -1)).toBe(SYNC_GRADIENT[0]);
		expect(sampleGradient(SYNC_GRADIENT, 2)).toBe(SYNC_GRADIENT.at(-1));
	});

	it('answers for a gradient too short to interpolate', () => {
		expect(sampleGradient(['#abcdef'], 0.5)).toBe('#abcdef');
		expect(sampleGradient([], 0.5)).toBe('#000000');
	});
});
