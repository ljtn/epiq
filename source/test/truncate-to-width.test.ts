import {describe, expect, it} from 'vitest';
import stringWidth from 'string-width';
import {truncateToWidth} from '../lib/utils/string.utils.js';

const RED = '\u001B[31m';
const RESET = '\u001B[0m';

describe('truncateToWidth', () => {
	it('leaves a string that already fits alone', () => {
		expect(truncateToWidth('short', 10)).toBe('short');
		expect(truncateToWidth('exactly-10', 10)).toBe('exactly-10');
	});

	it('cuts to the width it is given, ellipsis included', () => {
		expect(truncateToWidth('abcdefghij', 6)).toBe('abc...');
		expect(truncateToWidth('abcdefghij', 3)).toBe('...');
		expect(truncateToWidth('abcdefghij', 0)).toBe('');
	});

	// The event log is chalk-styled, so measuring in code units would spend most
	// of a row on escapes nobody can see.
	it('spends no columns on styling escapes', () => {
		const styled = `${RED}${'a'.repeat(40)}${RESET}`;

		expect(stringWidth(truncateToWidth(styled, 20))).toBe(20);
		expect(truncateToWidth(styled, 20)).toContain('a'.repeat(17));
	});

	// A cut made mid-style would otherwise bleed into the rest of the frame.
	it('closes a style it cuts inside of', () => {
		expect(truncateToWidth(`${RED}${'a'.repeat(40)}`, 20)).toMatch(
			/\u001B\[0m$/,
		);
		expect(truncateToWidth('a'.repeat(40), 20)).not.toContain('\u001B');
	});

	it('counts a wide glyph as the two columns it draws', () => {
		expect(truncateToWidth('\u672c'.repeat(20), 11)).toBe(
			'\u672c'.repeat(4) + '...',
		);
		expect(stringWidth(truncateToWidth('\u672c'.repeat(20), 11))).toBe(11);
	});
});
