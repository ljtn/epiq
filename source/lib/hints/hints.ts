import {Mode} from '../model/action-map.model.js';
import {NavNodeCtx} from '../model/context.model.js';

const initCommandPalette = 'Press : for command line';

const navigate = 'hjkl (navigate)';
const exit = 'q (exit)';
const edit = 'i (edit)';
const enter = 'e/enter (confirm)';

const initMove = 'd (cut)';
const moveSelection = 'hjkl (move issue)';
const confirmMove = 'd (paste)';

const addIssue = ':add name_of_issue (add issue)';

export const Hints = {
	[NavNodeCtx.WORKSPACE]: [navigate],
	[NavNodeCtx.BOARD]: [initCommandPalette],
	[NavNodeCtx.BOARD + Mode.COMMAND_LINE]: [],
	[NavNodeCtx.SWIMLANE]: [initMove, exit, addIssue],
	[NavNodeCtx.TICKET + Mode.HELP]: [exit],
	[NavNodeCtx.SWIMLANE + Mode.HELP]: [exit],
	[NavNodeCtx.TICKET]: [edit, initMove],
	[NavNodeCtx.FIELD]: [],
	[NavNodeCtx.SWIMLANE + Mode.MOVE]: [moveSelection, confirmMove],
	[NavNodeCtx.TICKET + Mode.MOVE]: [moveSelection, enter, confirmMove],
} as const;
