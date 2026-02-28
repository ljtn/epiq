import {storageManager} from '../../storage/storage-manager.js';
import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {appState} from '../../state/state.js';
import {nodeMapper} from '../../utils/node-mapper.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addBoard: NonNullable<CommandLineActionEntry['action']> = async (
	_ctx,
	_cmd,
	{value},
) => {
	const parent = appState.currentNode;
	const newItem = storageManager.createBoard(parent.id, value || 'New board');
	parent.children.push(nodeMapper.toBoard(newItem));
	navigator.navigate({selectedIndex: parent.children.length - 1});
};

export const addSwimlane: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const parent = appState.currentNode;
	const diskNode = storageManager.createSwimlane(
		parent.id,
		value || 'New lane',
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
	const newItem = storageManager.createIssue(parent.id, value || 'New Issue');
	parent.children.push(nodeMapper.toIssue(newItem));
	navigator.navigate({selectedIndex: parent.children.length - 1});
};
