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
	it('keeps distinct colours a visible distance apart', () => {
		// `assignees` and `jola` used to land on hues 244 and 242.
		const distance = hueDistance(
			hueOf(stringToHslHexColor('assignees')),
			hueOf(stringToHslHexColor('jola')),
		);

		expect(distance).toBeGreaterThanOrEqual(10);
	});

	it('never puts two names closer than one slot without matching exactly', () => {
		const names = [
			'bug',
			'chore',
			'feature',
			'time-travel',
			'assignees',
			'important',
			'attachments',
			'mcp',
			'tui',
			'gui',
			'docs',
			'urgent',
			// Each of these used to sit within a few degrees of one above.
			'jola',
			'epic',
			'wip',
			'api',
			'cli',
			'ci',
		];

		const hues = names.map(name => hueOf(stringToHslHexColor(name)));

		for (const [i, a] of hues.entries()) {
			for (const b of hues.slice(i + 1)) {
				const distance = hueDistance(a, b);
				// Either the same slot or a full slot apart — never a near-miss.
				expect(distance === 0 || distance >= 10).toBe(true);
			}
		}
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
