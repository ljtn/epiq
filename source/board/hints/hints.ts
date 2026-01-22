import {Mode} from '../../navigation/model/action-map.model.js';
import {BoardItemTypes} from '../model/board.model.js';

export const Hints = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [':h Help', 'hjkl: navigate', 'enter: confirm'],
	[BoardItemTypes.TICKET_LIST_ITEM + Mode.HELP]: ['q: exit'],
	[BoardItemTypes.SWIMLANE + Mode.HELP]: ['q: exit'],
	[BoardItemTypes.TICKET_LIST_ITEM]: ['i: edit', 'y: yank/move'],
	[BoardItemTypes.TICKET]: ['q: exit', 'i: edit'],
	[BoardItemTypes.SWIMLANE + Mode.MOVE]: [
		'hjkl: move selection',
		'e/enter: confirm move/yank',
		'q: exit',
	],
	[BoardItemTypes.TICKET_LIST_ITEM + Mode.MOVE]: [
		'hjkl: move selection',
		'e/enter: confirm move/yank',
		'y: confirm move/yank',
		'q: exit',
	],
} as const;
