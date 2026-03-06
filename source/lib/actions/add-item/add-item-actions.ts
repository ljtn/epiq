import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {NavNodeCtx} from '../../model/context.model.js';
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

	const newItem = storage.createNode({
		parentId: parent.id,
		name: value,
		nodeType: StorageNodeTypes.BOARD,
		children: TEMPLATES.swimlanes.map(v => ({
			id: SEED_RESOURCES.name,
			initialValue: v,
			name: v,
			type: StorageNodeTypes.SWIMLANE,
		})),
	});

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

	const diskNode = storage.createNode({
		parentId: parent.id,
		name,
		nodeType: StorageNodeTypes.SWIMLANE,
	});

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

	const newItem = storage.createNode({
		parentId: parent.id,
		name: value,
		nodeType: StorageNodeTypes.ISSUE,
		children: [
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
		],
	});

	if (!newItem) {
		logger.error('Unable to create ticket');
		return;
	}

	nodeRepository.appendChildToCurrentNodeAndSelect(nodeMapper.toIssue(newItem));
};

export const addListItem: NonNullable<
	CommandLineActionEntry['action']
> = async (_ctx, _cmd, {value}) => {
	const parent = getState().currentNode;

	if (parent.context !== NavNodeCtx.FIELD_LIST) {
		logger.error('Field item can only be added inside a FIELD node');
		return;
	}
	logger.info(value);

	// Default value if empty
	const itemValue = value || '';

	// Create a FIELD child under current FIELD
	const diskNode = storage.createNode({
		parentId: parent.id,
		name: SEED_RESOURCES.tag,
		props: {value},
		nodeType: StorageNodeTypes.FIELD,
	});

	if (!diskNode) {
		logger.error('Unable to add field item');
		return;
	}

	// Now update its value resource
	storage.updateNodeValue(StorageNodeTypes.FIELD, diskNode.id, itemValue);

	nodeRepository.appendChildToCurrentNodeAndSelect(
		nodeMapper.toField(diskNode),
	);
};
