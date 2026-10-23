import {describe, expect, it} from 'vitest';
import {assigneeText, cutFromFront} from './card-density';

describe('an assignee on a dense card', () => {
	it('is named whole where it fits', () => {
		expect(assigneeText([{name: 'claude/builder'}])).toEqual({
			text: 'claude/builder',
			full: 'claude/builder',
			cut: false,
		});
	});

	it('is cut from the front, back to its last slash where that fits', () => {
		expect(cutFromFront('claude/reviewer', 14)).toBe('…/reviewer');
		expect(cutFromFront('claude/communicator', 14)).toBe('…/communicator');
	});

	it('keeps its tail where even that does not fit', () => {
		expect(cutFromFront('a-very-long-name-without-a-slash', 10)).toBe(
			'…t-a-slash',
		);
		expect(cutFromFront('x/a-very-long-tail-name', 8)).toHaveLength(8);
	});

	it('names the first of several and counts the rest, all of them on hover', () => {
		const label = assigneeText([{name: 'jola'}, {name: 'claude/builder'}]);
		expect(label.text).toBe('jola +1');
		expect(label.full).toBe('jola, claude/builder');
		expect(label.cut).toBe(true);
	});

	it('is empty for a ticket nobody has', () => {
		expect(assigneeText([]).text).toBe('');
	});
});
