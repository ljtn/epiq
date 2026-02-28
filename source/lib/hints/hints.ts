import {Mode} from '../model/action-map.model.js';
import {NavNodeType} from '../model/context.model.js';

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
	[NavNodeType.WORKSPACE]: [navigate],
	[NavNodeType.BOARD]: [initCommandPalette],
	[NavNodeType.BOARD + Mode.COMMAND_LINE]: [],
	[NavNodeType.SWIMLANE]: [initMove, exit, addIssue],
	[NavNodeType.TICKET + Mode.HELP]: [exit],
	[NavNodeType.SWIMLANE + Mode.HELP]: [exit],
	[NavNodeType.TICKET]: [edit, initMove],
	[NavNodeType.FIELD]: [],
	[NavNodeType.SWIMLANE + Mode.MOVE]: [moveSelection, confirmMove],
	[NavNodeType.TICKET + Mode.MOVE]: [moveSelection, enter, confirmMove],
} as const;
