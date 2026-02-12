import {Mode} from '../../navigation/model/action-map.model.js';
import {Context} from '../model/context.model.js';

export const Hints = {
	[Context.WORKSPACE]: [],
	[Context.BOARD]: [],
	[Context.SWIMLANE]: [':h Help', 'hjkl: navigate', 'enter: confirm'],
	[Context.TICKET_LIST_ITEM + Mode.HELP]: ['q: exit'],
	[Context.SWIMLANE + Mode.HELP]: ['q: exit'],
	[Context.TICKET_LIST_ITEM]: ['i: edit', 'y: yank/move'],
	[Context.TICKET]: ['q: exit', 'i: edit'],
	[Context.SWIMLANE + Mode.MOVE]: [
		'hjkl: move selection',
		'e/enter: confirm move/yank',
		'q: exit',
	],
	[Context.TICKET_LIST_ITEM + Mode.MOVE]: [
		'hjkl: move selection',
		'e/enter: confirm move/yank',
		'y: confirm move/yank',
		'q: exit',
	],
} as const;
