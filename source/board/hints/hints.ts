import {Mode} from '../../navigation/model/action-map.model.js';
import {BoardItemTypes} from '../model/board.model.js';

export const Hints = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [
		'?: help',
		'ARROWS/HJKL: move between swimlanes',
		'E/ENTER: enter swimlane',
		'ESC/Q: exit',
	],
	[BoardItemTypes.TICKET_LIST_ITEM]: [
		'ARROWS/HJKL: move between tickets',
		'E/ENTER: view ticket details',
		'I: edit',
		'M: select for moving',
		'ESC/Q: exit',
	],
	[BoardItemTypes.TICKET]: ['E: back', 'I: edit field', 'ESC/Q: exit'],
	[BoardItemTypes.SWIMLANE + Mode.MOVE]: [
		'ARROWS/HJKL: move selection',
		'M: confirm move',
		'ESC/Q: exit',
	],
	[BoardItemTypes.TICKET_LIST_ITEM + Mode.MOVE]: [
		'ARROWS/HJKL: move selection',
		'M: confirm move',
		'ESC/Q: exit',
	],
} as const;
