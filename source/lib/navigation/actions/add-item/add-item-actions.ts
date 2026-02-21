import {ulid} from 'ulid';
import {contextMap, SwimlaneContext} from '../../../model/context.model.js';
import {
	storageManager,
	WorkspaceDiskNode,
} from '../../../storage/storage-manager.js';
import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {appState} from '../../state/state.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addSwimlaneAction: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const newItem: NavNode<SwimlaneContext> = {
		id: `${Date.now()}`,
		title: value || 'New lane',
		value: '...',
		context: contextMap.SWIMLANE,
		isSelected: false,
		childRenderAxis: 'vertical',
		childNavigationAcrossParents: true,
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
	const newTicket: WorkspaceDiskNode = {
		id: ulid(),
		children: [],
		name: value || 'New issue',
		value: '...',
	};

	const parent = appState.currentNode;
	parent.children ??= [];

	const newItemIndex = parent.children.length;

	const diskIssue = storageManager.createIssue(parent.id, newTicket);
	const stateIssue = storageManager.toIssue(diskIssue);

	parent.children.push(stateIssue);

	navigator.navigate({selectedIndex: newItemIndex});
};
