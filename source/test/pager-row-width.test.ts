import stringWidth from 'string-width';
import {describe, expect, it} from 'vitest';

import {padTo} from '../lib/components/CommitDiffUI.js';
import {truncateToWidth} from '../lib/utils/string.utils.js';

/**
 * A pager row is padded to the pane's edge in display columns, not characters,
 * or CJK and emoji rows overflow and ink wraps them.
 */
describe('a padded pager row', () => {
	const WIDTH = 40;

	const rows = [
		'plain ascii',
		'',
		'　全角の行がここにあります',
		'🙂🙂🙂 emoji lead the line',
		'mixed 全角 and ascii together',
		'a'.repeat(200),
		'全'.repeat(200),
	];

	it('is exactly the width it was asked for, whatever it holds', () => {
		for (const row of rows) {
			const padded = padTo(truncateToWidth(row, WIDTH), WIDTH);

			expect({row, width: stringWidth(padded)}).toEqual({row, width: WIDTH});
		}
	});

	it('leaves a row that already fills the width alone', () => {
		const full = 'a'.repeat(WIDTH);

		expect(padTo(full, WIDTH)).toBe(full);
	});

	// Two-column characters can't land on an odd budget; padding fills the gap.
	it('fills the last column a full-width row cannot reach', () => {
		const cut = truncateToWidth('全'.repeat(50), WIDTH);

		expect(stringWidth(cut)).toBe(WIDTH - 1);
		expect(stringWidth(padTo(cut, WIDTH))).toBe(WIDTH);
	});
});
