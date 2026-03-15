import {CmdResults, Result} from '../../command-line/command-types.js';
import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {StorageNodeTypes} from '../../model/storage-node.model.js';
import {nodeRepository} from '../../repository/node-repository.js';
import {getState} from '../../state/state.js';
import {SEED_RESOURCES, storage} from '../../storage/storage.js';
import {TEMPLATES} from '../../storage/templates.js';
import {nodeMapper} from '../../utils/node-mapper.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addBoard: NonNullable<CommandLineActionEntry['action']> = (
	_ctx,
	_cmd,
	{value: boardName},
): Result => {
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
		return {result: CmdResults.Fail};
	}
	nodeRepository.appendChildToCurrentNodeAndSelect(nodeMapper.toBoard(newItem));
	return {result: CmdResults.Succeed};
};

export const addSwimlane: NonNullable<CommandLineActionEntry['action']> = (
	_ctx,
	_cmd,
	{value},
): Result => {
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
		return {result: CmdResults.Fail};
	}
	nodeRepository.appendChildToCurrentNodeAndSelect(
		nodeMapper.toSwimlane(diskNode),
	);
	return {result: CmdResults.Succeed};
};

export const addTicket: NonNullable<CommandLineActionEntry['action']> = (
	_ctx,
	_cmd,
	{value},
): Result => {
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
					type: StorageNodeTypes.FIELD_LIST,
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
		return {result: CmdResults.Fail};
	}

	nodeRepository.appendChildToCurrentNodeAndSelect(nodeMapper.toIssue(newItem));
	return {result: CmdResults.Succeed};
};

export const addListItem = async (
	value: string,
	parent = getState().currentNode,
) => {
	nodeRepository.addListItem(SEED_RESOURCES.tag, value, parent);
	navigator.navigate({
		currentNode: parent,
		selectedIndex: parent.children.length,
	});
};
