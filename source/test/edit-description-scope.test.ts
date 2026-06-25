import {describe, expect, it, vi} from 'vitest';
import {CmdKeywords} from '../lib/command-line/cmd-keywords.js';

vi.mock('../lib/config/setup-utils.js', () => ({
	getUserSetupStatus: () => ({isSetupDone: true}),
	isRepositoryInitialized: () => true,
}));
vi.mock('../lib/repository/node-repo.js', () => ({
	nodeRepo: {getExistingTags: () => [], getExistingAssignees: () => []},
}));
vi.mock('../lib/utils/ticket.utils.js', () => ({
	getTicketAssignees: () => [],
	getTicketTags: () => [],
	ticketAssigneesFromBreadCrumb: () => ({status: 'success', value: []}),
	ticketTagsFromBreadCrumb: () => ({status: 'success', value: []}),
}));
vi.mock('../lib/state/state.js', () => ({getState: () => ({})}));

const {getCmdModifiers} = await import(
	'../lib/command-line/command-modifiers.js'
);

const ticket = {
	id: 't1',
	title: 'Ticket 1',
	context: 'TICKET',
	parentNodeId: 's1',
};
const descField = {
	id: 'd1',
	title: 'Description',
	context: 'FIELD',
	parentNodeId: 't1',
};
const assigneesField = {
	id: 'a1',
	title: 'Assignees',
	context: 'FIELD_LIST',
	parentNodeId: 't1',
};
const innerText = {
	id: 'tx',
	title: 'some text',
	context: 'TEXT',
	parentNodeId: 'd1',
};
const comment = {
	id: 'c1',
	title: 'a comment',
	context: 'COMMENT',
	parentNodeId: 'cm1',
};

const workspace = {id: 'w1', title: 'WS', context: 'WORKSPACE'};
const board = {id: 'b1', title: 'Board', context: 'BOARD', parentNodeId: 'w1'};
const swimlane = {
	id: 's1',
	title: 'Swimlane',
	context: 'SWIMLANE',
	parentNodeId: 'b1',
};
const commentsField = {
	id: 'cm1',
	title: 'Comments',
	context: 'FIELD',
	parentNodeId: 't1',
};
const commentText = {
	id: 'ctx',
	title: 'words',
	context: 'TEXT',
	parentNodeId: 'c1',
};

// buildBreadCrumb walks from the context node up to the root, so the breadcrumb
// always contains every ancestor (including the context node). A selection is a
// ticket descendant exactly when the ticket sits somewhere in that chain.
const state = (selectedNode: any, breadCrumb: any[], contextNode: any) =>
	({selectedNode, breadCrumb, contextNode, readOnly: false} as any);

describe('edit description available whenever a ticket is in scope', () => {
	const cases: [string, any][] = [
		[
			'ticket selected',
			state(ticket, [], {context: 'SWIMLANE', title: 's', id: 's1'}),
		],
		['description field', state(descField, [ticket], ticket)],
		['assignees field', state(assigneesField, [ticket], ticket)],
		['inner text', state(innerText, [ticket, descField], descField)],
		[
			'comment',
			state(
				comment,
				[...[workspace, board, swimlane, ticket, commentsField]],
				commentsField,
			),
		],
		// Deep, fully-realistic breadcrumbs (root → context node).
		[
			'description text (deep)',
			state(
				innerText,
				[workspace, board, swimlane, ticket, descField],
				descField,
			),
		],
		[
			'text inside a comment (deep)',
			state(
				commentText,
				[workspace, board, swimlane, ticket, commentsField, comment],
				comment,
			),
		],
		[
			'ticket selected on a board (full path)',
			state(ticket, [workspace, board, swimlane], swimlane),
		],
	];

	for (const [name, s] of cases) {
		it(`offers "description" modifier — ${name}`, () => {
			expect(getCmdModifiers(CmdKeywords.EDIT, s)).toContain('description');
		});
		it(`lists "edit" as available — ${name}`, () => {
			expect(getCmdModifiers(CmdKeywords.NONE, s)).toContain(CmdKeywords.EDIT);
		});
	}

	it('does NOT offer description outside a ticket (board/swimlane)', () => {
		const s = state(
			{id: 'b1', title: 'Board', context: 'BOARD', parentNodeId: 'w1'},
			[],
			{context: 'WORKSPACE', title: 'w', id: 'w1'},
		);
		expect(getCmdModifiers(CmdKeywords.EDIT, s)).not.toContain('description');
	});
});
