import {Box, Text} from 'ink';
import React from 'react';
import {nodeRepo} from '../actions/add-item/node-repo.js';
import {getOrderedChildren} from '../actions/add-item/rank.js';
import {Ticket} from '../model/context.model.js';
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
	const ticketChildren = getOrderedChildren(ticket.id);
	if (!ticketChildren) return fields;
	for (const field of ticketChildren) {
		if (!field.title) continue;
		const fieldChildren = getOrderedChildren(field.id);
		fields[field.title] = {
			value: sanitizeInlineText(field.props['value']),
			values: fieldChildren
				.map(child => sanitizeInlineText(child.props['value']))
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
	const contentWidth = width - 12;

	const title = truncateWithEllipsis(
		sanitizeInlineText(ticket.title),
		contentWidth,
	);

	const children = getOrderedChildren(ticket.id);

	const getListValues = (title: 'Tags' | 'Assignees') =>
		children
			.filter(
				(node): node is typeof node & {props: {value: string[]}} =>
					node.title === title && Array.isArray(node.props.value),
			)
			.flatMap(node => node.props.value);

	const tags = getListValues('Tags').map(nodeRepo.getTag);
	const assignees = getListValues('Assignees').map(nodeRepo.getContributor);

	return (
		<Box
			borderStyle="round"
			width={width - 6}
			height={4}
			flexDirection="column"
			borderColor={isSelected ? theme.accent : theme.secondary}
			justifyContent="space-between"
		>
			<Box borderBottom>
				<Box paddingLeft={1} flexDirection="column">
					<Text color={theme.primary}>{title}</Text>
					{/* <Text color={theme.secondary}>{description}</Text> */}
				</Box>
			</Box>

			<Box flexDirection="row" paddingLeft={1}>
				{tags.map(tag => (
					<TagUI key={tag?.id} id={tag?.id ?? ''}></TagUI>
				))}
				{assignees.map(assignee => (
					<AssigneeUI key={assignee?.id} id={assignee?.id ?? ''}></AssigneeUI>
				))}
			</Box>
		</Box>
	);
};
