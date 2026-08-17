import {describe, expect, it} from 'vitest';
import {getStringColor, stringToHslHexColor} from '../lib/utils/color.js';

// Hue of a hex colour, for asserting on separation rather than exact values.
const hueOf = (hex: string): number => {
	const [r, g, b] = [1, 3, 5].map(
		at => parseInt(hex.slice(at, at + 2), 16) / 255,
	) as [number, number, number];

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	if (max === min) return 0;

	const d = max - min;
	const hue =
		max === r
			? ((g - b) / d) % 6
			: max === g
			? (b - r) / d + 2
			: (r - g) / d + 4;

	return (hue * 60 + 360) % 360;
};

// Circular, so 359 and 1 count as two degrees apart rather than 358.
const hueDistance = (a: number, b: number): number => {
	const raw = Math.abs(a - b) % 360;
	return Math.min(raw, 360 - raw);
};

describe('stringToHslHexColor', () => {
	// Pinned, not derived: a tag's colour is something people learn, and the one
	// attempt at reshaping the palette (Q8NP90Q, reverted) moved `time-travel`
	// 176° without anything failing. Changing the scheme is allowed; doing it
	// without noticing is not, so these have to be edited on purpose.
	it('gives each name the colour it has always had', () => {
		expect({
			'time-travel': stringToHslHexColor('time-travel'),
			assignees: stringToHslHexColor('assignees'),
			jola: stringToHslHexColor('jola'),
			mcp: stringToHslHexColor('mcp'),
			tui: stringToHslHexColor('tui'),
			gui: stringToHslHexColor('gui'),
		}).toEqual({
			'time-travel': '#cc66a7',
			assignees: '#6d66cc',
			jola: '#6966cc',
			mcp: '#bb66cc',
			tui: '#cc7466',
			gui: '#6ecc66',
		});
	});

	it('spreads names over the whole circle', () => {
		const hues = ['time-travel', 'gui', 'tui', 'mcp', 'assignees'].map(name =>
			hueOf(stringToHslHexColor(name)),
		);

		// No minimum separation is promised — that is exactly what Q8NP90Q is
		// still open for — but the hash must not be collapsing onto a few values.
		expect(new Set(hues).size).toBe(hues.length);
		expect(Math.max(...hues) - Math.min(...hues)).toBeGreaterThan(180);
	});

	it('leaves close pairs close, which is the open half of Q8NP90Q', () => {
		// Documented rather than asserted away: `assignees` and `jola` both live
		// in this repo and are 2° apart. Any real fix has to move this number
		// without moving the pinned colours above.
		const distance = hueDistance(
			hueOf(stringToHslHexColor('assignees')),
			hueOf(stringToHslHexColor('jola')),
		);

		expect(distance).toBeLessThan(5);
	});

	it('is stable for a given name', () => {
		expect(stringToHslHexColor('bug')).toBe(stringToHslHexColor('bug'));
	});
});

describe('getStringColor', () => {
	it('ignores case and surrounding space', () => {
		expect(getStringColor('  Bug ')).toBe(getStringColor('bug'));
	});

	it('prefers a configured colour over the derived one', () => {
		expect(getStringColor('bug', {bug: '#123456'})).toBe('#123456');
	});
});
