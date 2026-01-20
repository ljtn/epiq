import {
	BoardItemTypes,
	Swimlane,
	TicketListItem,
} from '../../../board/model/board.model.js';
import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {NavigationTree} from '../../model/navigation-tree.model.js';

export const addSwimlaneAction: NonNullable<
	CommandLineActionEntry['action']
> = async (ctx, _, {value}) => {
	const newItem: NavigationTree<Swimlane> = {
		id: `${Date.now()}`,
		name: value || 'New lane',
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
};

export const addTicketAction: NonNullable<
	CommandLineActionEntry['action']
> = async (ctx, _, {value}) => {
	const newItem: NavigationTree<TicketListItem> = {
		id: `asdf${Date.now()}`,
		name: value || 'New issue',
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
};
