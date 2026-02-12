import {
	Context,
	Swimlane,
	TicketListItem,
} from '../../../board/model/context.model.js';
import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {NavigationTree} from '../../model/navigation-tree.model.js';
import {appState} from '../../state/state.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addSwimlaneAction: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const newItem: NavigationTree<Swimlane> = {
		id: `${Date.now()}`,
		name: value || 'New lane',
		description: '...',
		actionContext: Context.SWIMLANE,
		isSelected: false,
		childrenRenderAxis: 'vertical',
		enableChildNavigationAcrossContainers: true,
		children: [],
	};
	const parent = appState.currentNode;
	parent.children ??= [];

	const newItemIndex = parent.children.length;
	parent.children.push(newItem);

	navigator.navigate({selectedIndex: newItemIndex});
};

export const addTicketAction: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const newItem: NavigationTree<TicketListItem> = {
		id: `${Date.now()}`,
		name: value || 'New issue',
		actionContext: Context.TICKET_LIST_ITEM,
		isSelected: false,
		childrenRenderAxis: 'vertical',
		children: [
			{
				isSelected: false,
				id: `${Date.now()}`,
				name: 'Description',
				description: '...add description',
				actionContext: Context.TICKET,
				childrenRenderAxis: 'vertical',
				children: [],
			},
		],
	};
	const parent = appState.currentNode;
	parent.children ??= [];

	const newItemIndex = parent.children.length;
	parent.children.push(newItem);

	navigator.navigate({selectedIndex: newItemIndex});
};
