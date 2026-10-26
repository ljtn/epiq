import {describe, expect, it} from 'vitest';
import {GuiBoard, GuiIssue} from './gui-state.model';
import {goalStatsSignature} from './use-goal-stats';

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

describe('a goal stats signature', () => {
	const diff = {Ra: {commits: 1, insertions: 1, deletions: 0}};

	it('changes when a ticket is swapped for another, the count the same', () => {
		const before = board(['a', 'b'], {Todo: ['a', 'b', 'c'], Done: []});
		const after = board(['a', 'c'], {Todo: ['a', 'b', 'c'], Done: []});

		expect(goalStatsSignature('goal', [after], diff)).not.toBe(
			goalStatsSignature('goal', [before], diff),
		);
	});

	it('changes when a ticket in it gains a commit', () => {
		const one = board(['a'], {Todo: ['a'], Done: []});

		expect(
			goalStatsSignature('goal', [one], {
				Ra: {commits: 2, insertions: 3, deletions: 0},
			}),
		).not.toBe(goalStatsSignature('goal', [one], diff));
	});

	it('stays when a ticket only moves to Done', () => {
		const todo = board(['a'], {Todo: ['a'], Done: []});
		const done = board(['a'], {Todo: [], Done: ['a']});

		expect(goalStatsSignature('goal', [done], diff)).toBe(
			goalStatsSignature('goal', [todo], diff),
		);
	});
});
