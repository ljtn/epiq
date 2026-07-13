import {Box, Text} from 'ink';
import React from 'react';
import {Ticket} from '../model/context.model.js';
import {theme} from '../theme/themes.js';
import {
	sanitizeInlineText,
	truncateWithEllipsis,
} from '../utils/string.utils.js';
import {nodeRef} from '../utils/node-ref.js';
import {getTicketAssignees, getTicketTags} from '../utils/ticket.utils.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';
import {useFlashColor} from './useFlashColor.js';

export const TicketListItemUI: React.FC<{
	width: number;
	ticket: Ticket;
	isSelected: boolean;
	isFlashing?: boolean;
}> = ({width, ticket, isSelected, isFlashing = false}) => {
	const flashColor = useFlashColor(isFlashing);
	// own border (2) + paddingLeft (1) + slack (1)
	const contentWidth = width - 4;

	const title = truncateWithEllipsis(
		sanitizeInlineText(ticket.title),
		contentWidth,
	);
	const tags = getTicketTags(ticket);
	const assignees = getTicketAssignees(ticket);

	return (
		<Box
			borderStyle="round"
			height={4}
			flexDirection="column"
			borderDimColor={!isSelected}
			borderColor={
				isFlashing ? flashColor : isSelected ? theme.accent : theme.secondary
			}
			justifyContent="space-between"
		>
			<Box borderBottom>
				<Box paddingLeft={1} flexDirection="column">
					<Text color={theme.primary}>{title}</Text>
				</Box>
			</Box>

			<Box
				flexDirection="row"
				justifyContent="space-between"
				paddingLeft={1}
				paddingRight={1}
			>
				<Box flexDirection="row">
					{tags.map(tag => (
						<TagUI key={tag.id} id={tag.id} />
					))}
					{assignees.map(assignee => (
						<AssigneeUI key={assignee.id} id={assignee.id} />
					))}
				</Box>

				<Text wrap="truncate" color={theme.secondary2} dimColor>
					#{nodeRef(ticket.id)}
				</Text>
			</Box>
		</Box>
	);
};
