import {ulid} from 'ulid';
import {cmdResult, Result} from '../../command-line/command-types.js';
import {AnyContext, TicketContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {nodeRepository} from '../../repository/node-repository.js';
import {nodeBuilder} from '../../state/node-builder.js';
import {navigator} from '../default/navigation-action-utils.js';

export const addWorkspace = (workspaceName = 'Workspace') => {
	const workspace = nodeBuilder.workspace(workspaceName);
	return {result: cmdResult.Success, data: workspace};
};

export const addBoard = (parent: NavNode<AnyContext>, boardName: string) => {
	if (!parent) {
		return {
			result: cmdResult.Fail,
			message: 'Unable to add board in this context',
		} satisfies Result;
	}

	const board = nodeBuilder.board(boardName, parent.id);
	// nodeRepository.appendChildToNodeAndSelect(parent, board);

	return {result: cmdResult.Success, data: board};
};

export const addSwimlane = (
	parent: NavNode<AnyContext>,
	inputString: string,
) => {
	if (!parent) {
		return {
			result: cmdResult.Fail,
			message: 'Unable to add swimlane in this context',
		};
	}

	const swimlane = nodeBuilder.swimlane(inputString || 'New lane', parent.id);
	// nodeRepository.appendChildToNodeAndSelect(parent, swimlane);

	return {result: cmdResult.Success, data: swimlane};
};

export const addTicket = (parent: NavNode<AnyContext>, inputString: string) => {
	if (!parent) {
		return {
			result: cmdResult.Fail,
			message: 'Unable to create ticket in this context',
		};
	}

	const ticketId = ulid();

	const descriptionField = nodeBuilder.field('Description', ticketId);
	const assigneesField = nodeBuilder.fieldList('Assignees', ticketId);
	const tagsField = nodeBuilder.fieldList('Tags', ticketId);

	const issue: NavNode<TicketContext> = nodeBuilder.ticket(
		inputString,
		parent.id,
		[descriptionField.id, assigneesField.id, tagsField.id],
	);

	return {result: cmdResult.Success, data: issue};
};

export const addListItem = async (
	value: string,
	parent: NavNode<AnyContext>,
) => {
	nodeRepository.addListItem('seed:fieldName:tag', value, parent);
	navigator.navigate({
		currentNode: parent,
		selectedIndex: parent.children.length,
	});
};
