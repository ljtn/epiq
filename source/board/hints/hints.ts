import {Mode} from '../../navigation/model/action-map.model.js';
import {contextMap} from '../model/context.model.js';

export const Hints = {
	[contextMap.WORKSPACE]: [],
	[contextMap.BOARD]: [],
	[contextMap.SWIMLANE]: [':h Help', 'hjkl: navigate', 'enter: confirm'],
	[contextMap.TICKET_LIST_ITEM + Mode.HELP]: ['q: exit'],
	[contextMap.SWIMLANE + Mode.HELP]: ['q: exit'],
	[contextMap.TICKET_LIST_ITEM]: ['i: edit', 'y: yank/move'],
	[contextMap.TICKET]: ['q: exit', 'i: edit'],
	[contextMap.SWIMLANE + Mode.MOVE]: [
		'hjkl: move selection',
		'e/enter: confirm move/yank',
		'q: exit',
	],
	[contextMap.TICKET_LIST_ITEM + Mode.MOVE]: [
		'hjkl: move selection',
		'e/enter: confirm move/yank',
		'y: confirm move/yank',
		'q: exit',
	],
} as const;
