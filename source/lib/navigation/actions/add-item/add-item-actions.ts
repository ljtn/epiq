import {
	contextMap,
	SwimlaneContext,
	TicketContext,
	TicketFieldContext,
} from '../../../model/context.model.js';
import {DiscTicket, fileManager} from '../../../storage/file-manager.js';
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

export const ticketFromData = (data: DiscTicket): NavNode<TicketContext> => ({
	id: data.id,
	name: data.name,
	context: contextMap.TICKET,
	isSelected: false,
	childrenRenderAxis: 'vertical',
	children: data.fields
		.map(fieldId => {
			const fieldData = fileManager.getField(fieldId);
			if (!fieldData) {
				return null;
			}
			return fieldFromData({
				id: fieldId,
				name: fieldData.name,
				value: fieldData.value || '',
			});
		})
		.filter(x => x !== null),
});

const fieldFromData = (data: {
	id: string;
	name: string;
	value: string;
}): NavNode<TicketFieldContext> => ({
	id: data.id,
	name: data.name,
	value: data.value,
	context: contextMap.TICKET_FIELD,
	isSelected: false,
	childrenRenderAxis: 'vertical',
	children: [],
});
