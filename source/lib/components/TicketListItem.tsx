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

const splitAtWordBoundary = (
	value: string,
	width: number,
): [string, string | null] => {
	if (value.length <= width) return [value, null];

	const spaceAt = value.lastIndexOf(' ', width);
	const cut = spaceAt > 0 ? spaceAt : width;

	return [
		value.slice(0, cut),
		truncateWithEllipsis(value.slice(cut).trim(), width),
	];
};

export const TicketListItemUI: React.FC<{
	width: number;
	ticket: Ticket;
	isSelected: boolean;
	isFlashing?: boolean;
}> = ({width, ticket, isSelected, isFlashing = false}) => {
	const flashColor = useFlashColor(isFlashing);
	// own border (2) + paddingLeft (1) + slack (1)
	const contentWidth = width - 4;

	const [titleLine, titleOverflow] = splitAtWordBoundary(
		sanitizeInlineText(ticket.title),
		contentWidth,
	);

	// a long title claims the middle row; otherwise it previews the description
	const descriptionLine = titleOverflow
		? null
		: truncateWithEllipsis(
				sanitizeInlineText(ticket.props.description),
				contentWidth,
		  ) || null;

	const tags = getTicketTags(ticket);
	const assignees = getTicketAssignees(ticket);

	return (
		<Box
			borderStyle="round"
			height={5}
			flexDirection="column"
			borderDimColor={!isSelected}
			borderColor={
				isFlashing ? flashColor : isSelected ? theme.accent : theme.secondary
			}
			justifyContent="space-between"
		>
			<Box paddingLeft={1} flexDirection="column">
				<Text color={theme.primary}>{titleLine}</Text>
				{titleOverflow && <Text color={theme.primary}>{titleOverflow}</Text>}
				{descriptionLine && (
					<Text color={theme.secondary2} dimColor>
						{descriptionLine}
					</Text>
				)}
			</Box>

			<Box
				flexDirection="row"
				justifyContent="space-between"
				paddingLeft={1}
				paddingRight={1}
			>
				<Box flexDirection="row">
					{tags.map(tag => (
						<Box paddingRight={1} key={tag.id}>
							<TagUI key={tag.id} id={tag.id} />
						</Box>
					))}
					{assignees.map(assignee => (
						<Box paddingRight={1} key={assignee.id}>
							<AssigneeUI key={assignee.id} id={assignee.id} />
						</Box>
					))}
				</Box>

				<Text wrap="truncate" color={theme.secondary2} dimColor>
					{nodeRef(ticket.id)}
				</Text>
			</Box>
		</Box>
	);
};
