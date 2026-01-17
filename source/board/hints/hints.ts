import {Mode} from '../../navigation/model/action-map.model.js';
import {BoardItemTypes} from '../model/board.model.js';

export const Hints = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [
		'Arrows: move between lists',
		'Enter: open list',
		'M: select for moving',
		'Help: toggle help menu',
	],
	[BoardItemTypes.TICKET_LIST_ITEM]: [
		'Arrows: move between tickets',
		'Enter: open ticket',
		'M: select for moving',
		'E: back to swimlane',
	],
	[BoardItemTypes.TICKET]: [
		'Esc: back to list',
		'Arrows: move between fields',
		'E: back to list view',
	],
	[BoardItemTypes.SWIMLANE + Mode.MOVE]: ['M: confirm move'],
	[BoardItemTypes.TICKET_LIST_ITEM + Mode.MOVE]: ['M: confirm move'],
} as const;
