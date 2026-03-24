import {ulid} from 'ulid';
import {cmdResult, Result} from '../../command-line/command-types.js';
import {
	AnyContext,
	BoardContext,
	NavNodeCtx,
	SwimlaneContext,
	TicketContext,
	TicketFieldContext,
	TicketFieldListContext,
	WorkspaceContext,
} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {navigator} from '../default/navigation-action-utils.js';
import {nodeRepository} from '../../repository/node-repository.js';

const createWorkspaceNode = (name: string): NavNode<WorkspaceContext> => ({
	id: ulid(),
	name,
	props: {value: ''},
	context: NavNodeCtx.WORKSPACE,
	childRenderAxis: 'vertical',
	parentNodeId: null,
	children: [],
});

const createBoardNode = (
	name: string,
	parentNodeId: string,
): NavNode<BoardContext> => ({
	id: ulid(),
	name,
	props: {value: ''},
	context: NavNodeCtx.BOARD,
	childRenderAxis: 'horizontal',
	parentNodeId,
	children: [],
});

const createSwimlaneNode = (
	name: string,
	parentNodeId: string,
): NavNode<SwimlaneContext> => ({
	id: ulid(),
	name,
	props: {value: ''},
	context: NavNodeCtx.SWIMLANE,
	childRenderAxis: 'vertical',
	childNavigationAcrossParents: true,
	parentNodeId,
	children: [],
});

const createFieldNode = (
	name: string,
	parentNodeId: string,
	value = '',
): NavNode<TicketFieldContext> => ({
	id: ulid(),
	name,
	props: {value},
	context: NavNodeCtx.FIELD,
	childRenderAxis: 'vertical',
	parentNodeId,
	children: [],
});

const createFieldListNode = (
	name: string,
	parentNodeId: string,
): NavNode<TicketFieldListContext> => ({
	id: ulid(),
	name,
	props: {value: ''},
	context: NavNodeCtx.FIELD_LIST,
	childRenderAxis: 'horizontal',
	parentNodeId,
	children: [],
});

const createTicketNode = (
	name: string,
	parentNodeId: string,
	children: string[],
): NavNode<TicketContext> => ({
	id: ulid(),
	name,
	props: {value: ''},
	context: NavNodeCtx.TICKET,
	childRenderAxis: 'vertical',
	parentNodeId,
	children,
});

export const addWorkspace = (workspaceName = 'Workspace') => {
	const workspace = createWorkspaceNode(workspaceName);
	return {result: cmdResult.Success, data: workspace};
};

export const addBoard = (parent: NavNode<AnyContext>, boardName: string) => {
	if (!parent) {
		return {
			result: cmdResult.Fail,
			message: 'Unable to add board in this context',
		} satisfies Result;
	}

	const board = createBoardNode(boardName, parent.id);
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

	const swimlane = createSwimlaneNode(inputString || 'New lane', parent.id);
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

	const descriptionField = createFieldNode('Description', ticketId);
	const assigneesField = createFieldListNode('Assignees', ticketId);
	const tagsField = createFieldListNode('Tags', ticketId);

	const issue: NavNode<TicketContext> = createTicketNode(
		inputString,
		parent.id,
		[descriptionField.id, assigneesField.id, tagsField.id],
	);

	// nodeRepository.createNode?.(descriptionField);
	// nodeRepository.createNode?.(assigneesField);
	// nodeRepository.createNode?.(tagsField);
	// nodeRepository.appendChildToNodeAndSelect(parent, issue);

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
