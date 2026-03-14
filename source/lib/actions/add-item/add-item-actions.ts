import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {StorageNodeTypes} from '../../model/storage-node.model.js';
import {nodeRepository} from '../../repository/node-repository.js';
import {getState} from '../../state/state.js';
import {SEED_RESOURCES, storage} from '../../storage/storage.js';
import {TEMPLATES} from '../../storage/templates.js';
import {nodeMapper} from '../../utils/node-mapper.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addBoard: NonNullable<CommandLineActionEntry['action']> = async (
	_ctx,
	_cmd,
	{value: boardName},
) => {
	const parent = getState().currentNode;

	const newItem = storage.createNode({
		parentId: parent.id,
		definition: {
			name: boardName,
			type: StorageNodeTypes.BOARD,
			children: TEMPLATES.swimlanes.map(
				swimlaneName =>
					({
						name: swimlaneName,
						type: StorageNodeTypes.SWIMLANE,
					} as const),
			),
		},
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
		definition: {
			name,
			type: StorageNodeTypes.SWIMLANE,
		},
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
		definition: {
			name: value,
			type: StorageNodeTypes.ISSUE,
			children: [
				{
					nameId: SEED_RESOURCES.name,
					type: StorageNodeTypes.FIELD,
				},
				{
					nameId: SEED_RESOURCES.assignees,
					type: StorageNodeTypes.FIELD,
				},
				{
					nameId: SEED_RESOURCES.tags,
					type: StorageNodeTypes.FIELD_LIST,
				},
			],
		},
	});

	if (!newItem) {
		logger.error('Unable to create ticket');
		return;
	}

	nodeRepository.appendChildToCurrentNodeAndSelect(nodeMapper.toIssue(newItem));
};

export const addListItem = async (
	value: string,
	parent = getState().currentNode,
) => {
	nodeRepository.addListItem(value, parent);
	navigator.navigate({
		currentNode: parent,
		selectedIndex: parent.children.length,
	});
};
