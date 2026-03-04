import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {StorageNodeTypes} from '../../model/storage-node.model.js';
import {nodeRepository} from '../../repository/node-repository.js';
import {getState} from '../../state/state.js';
import {SEED_RESOURCES, storageManager} from '../../storage/storage-manager.js';
import {TEMPLATES} from '../../storage/templates.js';
import {nodeMapper} from '../../utils/node-mapper.js';

export const addBoard: NonNullable<CommandLineActionEntry['action']> = async (
	_ctx,
	_cmd,
	{value},
) => {
	const parent = getState().currentNode;

	const newItem = storageManager.createNode(
		parent.id,
		value,
		StorageNodeTypes.BOARD,
		TEMPLATES.swimlanes.map(v => ({id: SEED_RESOURCES.name, initialValue: v})),
	);

	if (!newItem) {
		logger.error('Unable to add board');
		return;
	}
	nodeRepository.appendChildToCurrentNodeAndSelect(nodeMapper.toBoard(newItem));
};

export const addSwimlane: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const parent = getState().currentNode;
	const title = value || 'New lane';

	const diskNode = storageManager.createNode(
		parent.id,
		title,
		StorageNodeTypes.SWIMLANE,
	);

	if (!diskNode) {
		logger.error('Unable to add swimlane');
		return;
	}
	nodeRepository.appendChildToCurrentNodeAndSelect(
		nodeMapper.toSwimlane(diskNode),
	);
};

export const addTicket: NonNullable<CommandLineActionEntry['action']> = async (
	_ctx,
	_cmd,
	{value},
) => {
	const parent = getState().currentNode;

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

	if (!newItem) {
		logger.error('Unable to create ticket');
		return;
	}

	nodeRepository.appendChildToCurrentNodeAndSelect(nodeMapper.toIssue(newItem));
};
