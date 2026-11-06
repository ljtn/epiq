import {GuiBoard, GuiGoal} from './gui-state.model.js';

/** Its Manage goals is the way in to closed goals, on a board that can use it. */
export const showsGoalStrip = (board: GuiBoard, goals: GuiGoal[]): boolean =>
	board.goals.length > 0 ||
	(!board.readonly && goals.some(goal => goal.closed));
