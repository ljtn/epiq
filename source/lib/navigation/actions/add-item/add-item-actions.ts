import {storageManager} from '../../../storage/storage-manager.js';
import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {appState} from '../../state/state.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addSwimlaneAction: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const parent = appState.currentNode;
	const newItem = storageManager.createSwimlane(parent.id, value || 'New lane');
	parent.children.push(newItem);
	navigator.navigate({selectedIndex: parent.children.length});
};

export const addTicketAction: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const parent = appState.currentNode;
	const newItem = storageManager.createIssue(parent.id, value || 'New Issue');
	parent.children.push(newItem);
	navigator.navigate({selectedIndex: parent.children.length});
};
