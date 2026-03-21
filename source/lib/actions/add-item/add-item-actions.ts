import {cmdResult, Result} from '../../command-line/command-types.js';
import {CommandLineActionEntry} from '../../model/action-map.model.js';
import {StorageNodeTypes} from '../../model/storage-node.model.js';
import {nodeRepository} from '../../repository/node-repository.js';
import {getState} from '../../state/state.js';
import {SEED_RESOURCES, storage} from '../../storage/storage.js';
import {TEMPLATES} from '../../storage/templates.js';
import {nodeMapper} from '../../utils/node-mapper.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addBoard: NonNullable<CommandLineActionEntry['action']> = (
	_cmd,
	{inputString: boardName},
): Result => {
	const parent = getState().breadCrumb.find(
		({context}) => context === 'WORKSPACE',
	);
	if (!parent) {
		return {
			result: cmdResult.Fail,
			message: 'Unable to add board in this context',
		};
	}

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
		return {result: cmdResult.Fail};
	}
	nodeRepository.appendChildToNodeAndSelect(
		parent,
		nodeMapper.toBoard(newItem),
	);
	return {result: cmdResult.Success};
};

export const addSwimlane: NonNullable<CommandLineActionEntry['action']> = (
	_cmd,
	{inputString},
): Result => {
	const parent = getState().breadCrumb.find(({context}) => context === 'BOARD');
	if (!parent) {
		return {
			result: cmdResult.Fail,
			message: 'Unable to add swimlane in this context',
		};
	}
	const name = inputString || 'New lane';

	const diskNode = storage.createNode({
		parentId: parent.id,
		definition: {
			name,
			type: StorageNodeTypes.SWIMLANE,
		},
	});

	if (!diskNode) {
		logger.error('Unable to add swimlane');
		return {result: cmdResult.Fail};
	}
	nodeRepository.appendChildToNodeAndSelect(
		parent,
		nodeMapper.toSwimlane(diskNode),
	);
	return {result: cmdResult.Success};
};

export const addTicket: NonNullable<CommandLineActionEntry['action']> = (
	_cmd,
	{inputString},
): Result => {
	const parent = getState().breadCrumb.find(
		({context}) => context === 'SWIMLANE',
	);

	if (!parent) {
		return {
			result: cmdResult.Fail,
			message: 'Unable to add issue in this context',
		};
	}

	const newItem = storage.createNode({
		parentId: parent.id,
		definition: {
			name: inputString,
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
		return {result: cmdResult.Fail};
	}

	nodeRepository.appendChildToNodeAndSelect(
		parent,
		nodeMapper.toIssue(newItem),
	);
	return {result: cmdResult.Success};
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
