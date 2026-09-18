import stringWidth from 'string-width';
import {describe, expect, it} from 'vitest';

import {padTo} from '../lib/components/CommitDiffUI.js';
import {truncateToWidth} from '../lib/utils/string.utils.js';

/**
 * A pager row is padded out so the cursor's highlight runs to the edge of the
 * pane. The padding has to be measured the same way the text beside it was cut
 * — in display columns — or a row of CJK or emoji is padded by character count,
 * overflows the pane, and ink wraps it onto a second terminal line. Every row
 * then stands two rows tall while `ScrollBoxUI` is told each is one, which is
 * the scrolling failure `diff.e2e.test.ts` guards against.
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

	// Two columns per character cannot land exactly on an odd budget, so a
	// full-width row is padded by the column it falls short — which is the
	// whole reason the measure has to be columns rather than characters.
	it('fills the last column a full-width row cannot reach', () => {
		const cut = truncateToWidth('全'.repeat(50), WIDTH);

		expect(stringWidth(cut)).toBe(WIDTH - 1);
		expect(stringWidth(padTo(cut, WIDTH))).toBe(WIDTH);
	});
});
