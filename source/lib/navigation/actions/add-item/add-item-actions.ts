import {
	contextMap,
	SwimlaneContext,
	TicketContext,
} from '../../../model/context.model.js';
import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {appState} from '../../state/state.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addSwimlaneAction: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const newItem: NavNode<SwimlaneContext> = {
		id: `${Date.now()}`,
		name: value || 'New lane',
		value: '...',
		context: contextMap.SWIMLANE,
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
	const newItem: NavNode<TicketContext> = {
		id: `${Date.now()}`,
		name: value || 'New issue',
		value: '',
		context: contextMap.TICKET,
		isSelected: false,
		childrenRenderAxis: 'vertical',
		children: [
			{
				isSelected: false,
				id: `${Date.now()}`,
				name: 'Description',
				value: 'No description added',
				context: contextMap.TICKET_FIELD,
				childrenRenderAxis: 'vertical',
				children: [],
			},
			{
				isSelected: false,
				id: `${Date.now()}`,
				name: 'Tags',
				value: 'default',
				context: contextMap.TICKET_FIELD,
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
