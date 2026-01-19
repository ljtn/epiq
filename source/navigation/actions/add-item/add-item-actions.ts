import {
	BoardItemTypes,
	Swimlane,
	TicketListItem,
} from '../../../board/model/board.model.js';
import {ActionEntry, Mode} from '../../model/action-map.model.js';
import {NavigationTree} from '../../model/navigation-tree.model.js';
import {KeyIntent} from '../../utils/key-intent.js';

export const addSwimlaneAction: ActionEntry = {
	intent: KeyIntent.AddItem,
	mode: Mode.DEFAULT,
	description: '[A] Add item',
	action: async ctx => {
		const newItem: NavigationTree<Swimlane> = {
			id: `${Date.now()}`,
			name: `New Item ${Date.now()}`,
			description: '...',
			actionContext: BoardItemTypes.SWIMLANE,
			children: [],
			isSelected: false,
			childrenRenderAxis: 'vertical',
			enableChildNavigationAcrossContainers: true,
		};
		const parent = ctx.navigationNode;
		parent.children ??= [];

		const newItemIndex = parent.children.length;
		parent.children.push(newItem);

		ctx.updateSelection(newItemIndex);
	},
};

export const addTicketAction: ActionEntry = {
	intent: KeyIntent.AddItem,
	mode: Mode.DEFAULT,
	description: '[A] Add ticket',
	action: ctx => {
		const newItem: NavigationTree<TicketListItem> = {
			id: `asdf${Date.now()}`,
			name: 'New ticket',
			actionContext: BoardItemTypes.TICKET_LIST_ITEM,
			children: [],
			isSelected: false,
			childrenRenderAxis: 'vertical',
			description: '',
		};
		const parent = ctx.navigationNode;
		parent.children ??= [];

		const newItemIndex = parent.children.length;
		parent.children.push(newItem);

		ctx.updateSelection(newItemIndex);
	},
};
