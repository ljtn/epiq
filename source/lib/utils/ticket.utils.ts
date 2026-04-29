import {nodeRepo} from '../../repository/node-repo.js';
import {failed, Result, succeeded} from '../command-line/command-types.js';
import {Contributor, Tag} from '../model/app-state.model.js';
import {isTicketNode, Ticket} from '../model/context.model.js';
import {getRenderedChildren, getState} from '../state/state.js';
import {sanitizeInlineText} from '../utils/string.utils.js';

type TicketFieldMap = Record<
	string,
	{
		value: string;
		values: string[];
	}
>;

export const getTicketFields = (ticket: Ticket): TicketFieldMap => {
	const fields: TicketFieldMap = {};

	const ticketChildren = getRenderedChildren(ticket.id);

	for (const field of ticketChildren) {
		if (!field.title) continue;

		const fieldChildren = getRenderedChildren(field.id);

		fields[field.title] = {
			value:
				typeof field.props?.value === 'string'
					? sanitizeInlineText(field.props.value)
					: '',
			values: fieldChildren
				.map(child =>
					typeof child.props?.value === 'string'
						? sanitizeInlineText(child.props.value)
						: '',
				)
				.filter(Boolean),
		};
	}

	return fields;
};

export const getTicketReferencedIds = (
	ticket: Ticket,
	fieldTitle: 'Tags' | 'Assignees',
): string[] => {
	const children = getRenderedChildren(ticket.id);
	const fieldNode = children.find(node => node.title === fieldTitle);

	if (!fieldNode) return [];

	return getRenderedChildren(fieldNode.id)
		.map(child =>
			typeof child.props?.value === 'string' ? child.props.value : '',
		)
		.filter((value): value is string => Boolean(value));
};

export const getTicketTags = (ticket: Ticket): Tag[] =>
	getTicketReferencedIds(ticket, 'Tags')
		.map(tagId => nodeRepo.getTag(tagId))
		.filter((tag): tag is Tag => Boolean(tag));

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
		getTicketTags(ticket) ?? [],
	);
};

export const ticketAssigneesFromBreadCrumb = (): Result<Contributor[]> => {
	const {breadCrumb, selectedNode} = getState();
	const ticket = [...breadCrumb, selectedNode].find(
		x => x?.context === 'TICKET',
	);
	if (!ticket || !isTicketNode(ticket)) {
		return failed('Invalid untag target');
	}

	return succeeded(
		'Retrieved tags from ticket in breadcrumb',
		getTicketAssignees(ticket) ?? [],
	);
};

export const getTicketAssignees = (ticket: Ticket): Contributor[] =>
	getTicketReferencedIds(ticket, 'Assignees')
		.map(contributorId => nodeRepo.getContributor(contributorId))
		.filter((contributor): contributor is Contributor => Boolean(contributor));

export const serializeTicket = (ticket: Ticket) => ({
	id: ticket.id,
	title: ticket.title,
	parentId: ticket.parentNodeId,
	fields: getTicketFields(ticket),
	tags: getTicketTags(ticket).map(tag => ({
		id: tag.id,
		name: tag.name,
	})),
	assignees: getTicketAssignees(ticket).map(assignee => ({
		id: assignee.id,
		name: assignee.name,
	})),
});

export const getFieldValue = (ticket: Ticket, fieldTitle: string): string => {
	const children = getRenderedChildren(ticket.id);
	const fieldNode = children.find(node => node.title === fieldTitle);

	if (!fieldNode) return '';

	return typeof fieldNode.props?.value === 'string'
		? sanitizeInlineText(fieldNode.props.value)
		: '';
};

export const getFieldNode = (ticket: Ticket, fieldTitle: string) => {
	const children = getRenderedChildren(ticket.id);
	return children.find(node => node.title === fieldTitle) ?? null;
};
