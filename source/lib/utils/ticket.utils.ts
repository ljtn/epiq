import {Contributor, Tag} from '../model/app-state.model.js';
import {isTicketNode, Ticket} from '../model/context.model.js';
import {failed, Result, succeeded} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getState} from '../state/state.js';

export const getTicketTagIds = (ticket: Ticket): string[] =>
	ticket.props.tags ?? [];

export const getTicketAssigneeIds = (ticket: Ticket): string[] =>
	ticket.props.assignees ?? [];

export const getTicketTags = (ticket: Ticket): Tag[] =>
	getTicketTagIds(ticket)
		.map(tag => nodeRepo.getTag(tag))
		.filter((tag): tag is Tag => Boolean(tag));

export const getTicketAssignees = (ticket: Ticket): Contributor[] =>
	getTicketAssigneeIds(ticket)
		.map(assignee => nodeRepo.getContributor(assignee))
		.filter((contributor): contributor is Contributor => Boolean(contributor));

export const ticketTagsFromBreadCrumb = (): Result<Tag[]> => {
	const {breadCrumb, selectedNode} = getState();
	const ticket = [...breadCrumb, selectedNode].find(
		x => x?.context === 'TICKET',
	);

	if (!ticket || !isTicketNode(ticket)) {
		return failed('Invalid untag target');
	}

	return succeeded(
		'Retrieved tags from ticket in breadcrumb',
		getTicketTags(ticket),
	);
};

export const ticketAssigneesFromBreadCrumb = (): Result<Contributor[]> => {
	const {breadCrumb, selectedNode} = getState();
	const ticket = [...breadCrumb, selectedNode].find(
		x => x?.context === 'TICKET',
	);

	if (!ticket || !isTicketNode(ticket)) {
		return failed('Invalid unassign target');
	}

	return succeeded(
		'Retrieved assignees from ticket in breadcrumb',
		getTicketAssignees(ticket),
	);
};
