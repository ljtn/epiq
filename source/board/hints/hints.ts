import {Mode} from '../../navigation/model/action-map.model.js';
import {BoardItemTypes} from '../model/board.model.js';

export const Hints = {
	[BoardItemTypes.BOARD]: ['A: add swimlane'],
	[BoardItemTypes.SWIMLANE]: [
		':h Help',
		'ARROWS/HJKL: move between swimlanes',
		'E/ENTER: enter swimlane',
		'ESC/Q: exit',
	],
	[BoardItemTypes.TICKET_LIST_ITEM]: [
		'ARROWS/HJKL: move between tickets',
		'E/ENTER: view ticket details',
		'I: edit',
		'Y: select for yank/move',
		'ESC/Q: exit',
	],
	[BoardItemTypes.TICKET]: ['ESC/Q: exit', 'I: edit field'],
	[BoardItemTypes.SWIMLANE + Mode.MOVE]: [
		'ARROWS/HJKL: move selection',
		'Y: confirm move/yank',
		'ESC/Q: exit',
	],
	[BoardItemTypes.TICKET_LIST_ITEM + Mode.MOVE]: [
		'ARROWS/HJKL: move selection',
		'Y: confirm move/yank',
		'ESC/Q: exit',
	],
} as const;
