import {describe, expect, it} from 'vitest';
import {GuiBoard, GuiIssue} from './gui-state.model';
import {goalCodeSignature} from './use-goal-code';

const issue = (id: string, ref: string) => ({id, ref} as GuiIssue);

const board = (members: string[], lanes: Record<string, string[]>) =>
	({
		goals: [
			{
				id: 'goal',
				members: members.map(id => ({id, done: lanes['Done']!.includes(id)})),
			},
		],
		swimlanes: Object.entries(lanes).map(([title, ids]) => ({
			title,
			issues: ids.map(id => issue(id, `R${id}`)),
		})),
	} as unknown as GuiBoard);

describe('a goal code signature', () => {
	const diff = {Ra: {commits: 1, insertions: 1, deletions: 0}};

	it('changes when a ticket is swapped for another, the count the same', () => {
		const before = board(['a', 'b'], {Todo: ['a', 'b', 'c'], Done: []});
		const after = board(['a', 'c'], {Todo: ['a', 'b', 'c'], Done: []});

		expect(goalCodeSignature('goal', [after], diff)).not.toBe(
			goalCodeSignature('goal', [before], diff),
		);
	});

	it('changes when a ticket in it gains a commit', () => {
		const one = board(['a'], {Todo: ['a'], Done: []});

		expect(
			goalCodeSignature('goal', [one], {
				Ra: {commits: 2, insertions: 3, deletions: 0},
			}),
		).not.toBe(goalCodeSignature('goal', [one], diff));
	});

	it('stays when a ticket only moves to Done', () => {
		const todo = board(['a'], {Todo: ['a'], Done: []});
		const done = board(['a'], {Todo: [], Done: ['a']});

		expect(goalCodeSignature('goal', [done], diff)).toBe(
			goalCodeSignature('goal', [todo], diff),
		);
	});
});
