import {Mode} from '../../navigation/model/action-map.model.js';
import {BoardItemTypes} from '../model/board.model.js';

export const Hints = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [
		':h Help',
		'a: add swimlane',
		'hjkl: move between swimlanes',
		'e: enter swimlane',
		'q: exit',
	],
	[BoardItemTypes.TICKET_LIST_ITEM]: [
		'hjkl: move between tickets',
		'e: view ticket details',
		'i: edit',
		'y: select for yank/move',
		'q: exit',
	],
	[BoardItemTypes.TICKET]: ['q: exit', 'I: edit field'],
	[BoardItemTypes.SWIMLANE + Mode.MOVE]: [
		'hjkl: move selection',
		'y: confirm move/yank',
		'q: exit',
	],
	[BoardItemTypes.TICKET_LIST_ITEM + Mode.MOVE]: [
		'hjkl: move selection',
		'y: confirm move/yank',
		'q: exit',
	],
} as const;
