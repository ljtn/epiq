import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {StorageNodeTypes} from '../../model/storage-node.model.js';
import {appState} from '../../state/state.js';
import {SEED_RESOURCES, storageManager} from '../../storage/storage-manager.js';
import {TEMPLATES} from '../../storage/templates.js';
import {nodeMapper} from '../../utils/node-mapper.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addBoard: NonNullable<CommandLineActionEntry['action']> = async (
	_ctx,
	_cmd,
	{value},
) => {
	const parent = appState.currentNode;
	const newItem = storageManager.createNode(
		parent.id,
		value,
		StorageNodeTypes.BOARD,
		TEMPLATES.swimlanes.map(value => ({
			id: SEED_RESOURCES.name,
			initialValue: value,
		})),
	);
	parent.children.push(nodeMapper.toBoard(newItem));
	navigator.navigate({selectedIndex: parent.children.length - 1});
};

export const addSwimlane: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const parent = appState.currentNode;
	value = value || 'New lane';
	const diskNode = storageManager.createNode(
		parent.id,
		value,
		StorageNodeTypes.SWIMLANE,
	);
	parent.children.push(nodeMapper.toSwimlane(diskNode));
	navigator.navigate({selectedIndex: parent.children.length - 1});
};

export const addTicket: NonNullable<CommandLineActionEntry['action']> = async (
	_ctx,
	_cmd,
	{value},
) => {
	const parent = appState.currentNode;
	const newItem = storageManager.createNode(
		parent.id,
		value,
		StorageNodeTypes.ISSUE,
		[
			{id: SEED_RESOURCES.name, initialValue: '...'},
			{id: SEED_RESOURCES.assignees, initialValue: 'None'},
			{id: SEED_RESOURCES.tags, initialValue: 'default'},
		],
	);
	parent.children.push(nodeMapper.toIssue(newItem));
	navigator.navigate({selectedIndex: parent.children.length - 1});
};
