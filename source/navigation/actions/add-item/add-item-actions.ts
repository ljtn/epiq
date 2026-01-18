import {board} from '../../../board/mock/board.js';
import {
	BoardItemTypes,
	Swimlane,
	TicketListItem,
} from '../../../board/model/board.model.js';
import {triggerRender} from '../../../cli.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {NavigationTree} from '../../model/navigation-tree.model.js';
import {navigationState} from '../../state/state.js';
import {KeyIntent} from '../../utils/key-intent.js';

export const addSwimlaneAction: ActionEntry = {
	intent: KeyIntent.AddItem,
	mode: Mode.DEFAULT,
	description: '[A] Add item',
	action: () => {
		const newItem: NavigationTree<Swimlane> = {
			id: `item-${Date.now()}`,
			name: 'New Item',
			actionContext: 'SWIMLANE',
			children: [],
			isSelected: false,
			childrenRenderAxis: 'vertical',
			enableChildNavigationAcrossContainers: true,
			description: '',
		};
		console.clear();
		console.log('Adding new swimlane:', newItem);
		board.children.push(newItem);
		triggerRender();
	},
};

export const addTicketAction: ActionEntry = {
	intent: KeyIntent.AddItem,
	mode: Mode.DEFAULT,
	description: '[A] Add ticket',
	action: () => {
		const newItem: NavigationTree<TicketListItem> = {
			id: `item-${Date.now()}`,
			name: 'New ticket',
			actionContext: BoardItemTypes.TICKET_LIST_ITEM,
			children: [],
			isSelected: false,
			childrenRenderAxis: 'vertical',
			description: '',
		};
		navigationState?.currentNode?.children.push(newItem);
		triggerRender();
	},
};
