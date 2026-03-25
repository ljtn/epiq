import {Box, Text} from 'ink';
import React from 'react';
import {AppState} from '../model/app-state.model.js';
import {Ticket} from '../model/context.model.js';
import {theme} from '../theme/themes.js';
import {filterMap} from '../utils/array.utils.js';
import {
	sanitizeInlineText,
	truncateWithEllipsis,
} from '../utils/string.utils.js';
import {TagUI} from './Tag.js';

type TicketFieldMap = Record<
	string,
	{
		value: string;
		values: string[];
	}
>;

export const getTicketFields = (
	ticket: Ticket,
	nodes: AppState['nodes'],
): TicketFieldMap => {
	const fields: TicketFieldMap = {};

	if (!ticket) return fields;
	const ticketChildren = filterMap(ticket.children, id => nodes[id]);
	if (!ticketChildren) return fields;
	for (const field of ticketChildren) {
		if (!field.title) continue;
		const fieldChildren = filterMap(field.children, id => nodes[id]);
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
	nodes: AppState['nodes'];
}> = ({width, ticket, isSelected, nodes}) => {
	const fields = ticket ? getTicketFields(ticket, nodes) : null;

	const contentWidth = width - 12;

	const title = truncateWithEllipsis(
		sanitizeInlineText(ticket.title),
		contentWidth,
	);

	// const description = truncateWithEllipsis(
	// 	fields['Description']?.value ?? '',
	// 	contentWidth,
	// );

	const tags = fields?.['Tags']?.values ?? [];

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
				{tags.map((tag, index) => (
					<Box key={`${tag}-${index}`} paddingRight={1}>
						<TagUI name={tag} />
					</Box>
				))}
			</Box>
		</Box>
	);
};
