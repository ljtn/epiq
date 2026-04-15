import {Box, Text} from 'ink';
import React from 'react';
import {nodeRepo} from '../../repository/node-repo.js';
import {Contributor, Tag} from '../model/app-state.model.js';
import {Ticket} from '../model/context.model.js';
import {getRenderedChildren} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {
	sanitizeInlineText,
	truncateWithEllipsis,
} from '../utils/string.utils.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';

type TicketFieldMap = Record<
	string,
	{
		value: string;
		values: string[];
	}
>;

export const getTicketFields = (ticket: Ticket): TicketFieldMap => {
	const fields: TicketFieldMap = {};

	if (!ticket) return fields;

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

export const TicketListItemUI: React.FC<{
	width: number;
	ticket: Ticket;
	isSelected: boolean;
}> = ({width, ticket, isSelected}) => {
	const contentWidth = width - 14;

	const title = truncateWithEllipsis(
		sanitizeInlineText(ticket.title),
		contentWidth,
	);

	const children = getRenderedChildren(ticket.id);

	const getReferencedIds = (title: 'Tags' | 'Assignees') => {
		const fieldNode = children.find(node => node.title === title);
		if (!fieldNode) return [];

		return getRenderedChildren(fieldNode.id)
			.map(child =>
				typeof child.props?.value === 'string' ? child.props.value : '',
			)
			.filter((value): value is string => Boolean(value));
	};

	const tags = getReferencedIds('Tags')
		.map(tagId => nodeRepo.getTag(tagId))
		.filter((s): s is Tag => Boolean(s));

	const assignees = getReferencedIds('Assignees')
		.map(contributorId => nodeRepo.getContributor(contributorId))
		.filter((s): s is Contributor => Boolean(s));

	return (
		<Box
			borderStyle="round"
			width={width - 7}
			height={4}
			flexDirection="column"
			borderColor={isSelected ? theme.accent : theme.secondary}
			justifyContent="space-between"
		>
			<Box borderBottom>
				<Box paddingLeft={1} flexDirection="column">
					<Text color={theme.primary}>{title}</Text>
				</Box>
			</Box>

			<Box flexDirection="row" paddingLeft={1}>
				{tags.map(tag => (
					<TagUI key={tag.id} id={tag.id} />
				))}
				{assignees.map(assignee => (
					<AssigneeUI key={assignee.id} id={assignee.id} />
				))}
			</Box>
		</Box>
	);
};
