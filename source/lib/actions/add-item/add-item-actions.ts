import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {StorageNodeTypes} from '../../model/storage-node.model.js';
import {nodeRepository} from '../../repository/node-repository.js';
import {getState} from '../../state/state.js';
import {SEED_RESOURCES, storage} from '../../storage/storage.js';
import {TEMPLATES} from '../../storage/templates.js';
import {nodeMapper} from '../../utils/node-mapper.js';

export const addBoard: NonNullable<CommandLineActionEntry['action']> = async (
	_ctx,
	_cmd,
	{value},
) => {
	const parent = getState().currentNode;

	const newItem = storage.createNode(
		parent.id,
		value,
		StorageNodeTypes.BOARD,
		TEMPLATES.swimlanes.map(v => ({
			id: SEED_RESOURCES.name,
			initialValue: v,
			name: v,
			type: StorageNodeTypes.SWIMLANE,
		})),
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
	const name = value || 'New lane';

	const diskNode = storage.createNode(
		parent.id,
		name,
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

	const newItem = storage.createNode(parent.id, value, StorageNodeTypes.ISSUE, [
		{
			id: SEED_RESOURCES.name,
			name: 'Name',
			initialValue: '...',
			type: StorageNodeTypes.FIELD,
		},
		{
			id: SEED_RESOURCES.assignees,
			name: 'Assignees',
			initialValue: 'None',
			type: StorageNodeTypes.FIELD,
		},
		{
			id: SEED_RESOURCES.tags,
			name: 'Tags',
			initialValue: '',
			type: StorageNodeTypes.FIELD,
			children: [
				{
					name: SEED_RESOURCES.tag,
					initialValue: 'default',
					type: StorageNodeTypes.FIELD,
				},
				{
					name: SEED_RESOURCES.tag,
					initialValue: 'urgent',
					type: StorageNodeTypes.FIELD,
				},
			],
		},
	]);

	if (!newItem) {
		logger.error('Unable to create ticket');
		return;
	}

	nodeRepository.appendChildToCurrentNodeAndSelect(nodeMapper.toIssue(newItem));
};
