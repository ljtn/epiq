import {Mode} from '../model/action-map.model.js';
import {NavNodeCtx} from '../model/context.model.js';

const initCommandPalette = 'Press : for command line';

const navigate = 'HJKL (navigate)';
const exit = 'Q (exit)';
const edit = 'I (edit)';
const enter = 'E (enter)';

const initMove = 'M (move)';
const moveSelection = 'HJKL (move issue)';
const confirmMove = 'M (move confirm)';

// const newIssue = ':new (add item)';

export const Hints = {
	[NavNodeCtx.WORKSPACE]: [navigate],
	[NavNodeCtx.BOARD]: [initCommandPalette],
	[NavNodeCtx.BOARD + Mode.COMMAND_LINE]: [],
	[NavNodeCtx.SWIMLANE]: [initCommandPalette, navigate, initMove],
	// [NavNodeCtx.SWIMLANE]: [initMove, exit, newIssue],
	[NavNodeCtx.TICKET + Mode.HELP]: [exit],
	[NavNodeCtx.SWIMLANE + Mode.HELP]: [exit],
	[NavNodeCtx.TICKET]: [edit, enter],
	[NavNodeCtx.FIELD]: [],
	[NavNodeCtx.SWIMLANE + Mode.MOVE]: [moveSelection, confirmMove],
	[NavNodeCtx.TICKET + Mode.MOVE]: [moveSelection, enter],
} as const;
