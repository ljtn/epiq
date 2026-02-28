import {Mode} from '../model/action-map.model.js';
import {contextMap} from '../model/context.model.js';

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
	[contextMap.WORKSPACE]: [navigate],
	[contextMap.BOARD]: [initCommandPalette],
	[contextMap.BOARD + Mode.COMMAND_LINE]: [],
	[contextMap.SWIMLANE]: [initMove, exit, addIssue],
	[contextMap.TICKET + Mode.HELP]: [exit],
	[contextMap.SWIMLANE + Mode.HELP]: [exit],
	[contextMap.TICKET]: [edit, initMove],
	[contextMap.FIELD]: [],
	[contextMap.SWIMLANE + Mode.MOVE]: [moveSelection, confirmMove],
	[contextMap.TICKET + Mode.MOVE]: [moveSelection, enter, confirmMove],
} as const;
