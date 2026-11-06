import {describe, expect, it} from 'vitest';
import {showsGoalStrip} from '../gui/client/lib/goal-strip.js';
import {GuiBoard, GuiGoal} from '../gui/client/lib/gui-state.model.js';

const board = (over: Partial<GuiBoard>) =>
	({goals: [], readonly: false, ...over} as GuiBoard);
const goal = (over: Partial<GuiGoal> = {}) =>
	({id: 'G', name: 'G', color: '#fff', done: 0, total: 1, ...over} as GuiGoal);

describe('the goal strip', () => {
	it('shows for a goal on the board', () => {
		const shown = board({goals: [{...goal(), members: []}], readonly: true});
		expect(showsGoalStrip(shown, [])).toBe(true);
	});

	it('shows for Manage goals on a board with only closed ones behind it', () => {
		expect(showsGoalStrip(board({}), [goal({closed: true})])).toBe(true);
	});

	it('stays away from a board with nothing to show', () => {
		expect(showsGoalStrip(board({}), [goal()])).toBe(false);
	});

	it('stays away from a read-only board, which has no Manage goals', () => {
		const pastBoard = board({readonly: true});
		expect(showsGoalStrip(pastBoard, [goal({closed: true})])).toBe(false);
	});
});
