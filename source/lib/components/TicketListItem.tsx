import {Box, Text} from 'ink';
import React from 'react';
import {Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {theme} from '../theme/themes.js';
import {
	sanitizeInlineText,
	truncateWithEllipsis,
} from '../utils/string.utils.js';
import {hasAuthoredEvents} from '../utils/contributor.utils.js';
import {nodeRef, NODE_REF_LENGTH} from '../utils/node-ref.js';
import {getTicketAssignees, getTicketTags} from '../utils/ticket.utils.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';
import {useFlashColor} from './useFlashColor.js';

const splitAtWordBoundary = (
	value: string,
	width: number,
	overflowWidth: number,
): [string, string | null] => {
	if (value.length <= width) return [value, null];

	const spaceAt = value.lastIndexOf(' ', width);
	const cut = spaceAt > 0 ? spaceAt : width;

	return [
		value.slice(0, cut),
		truncateWithEllipsis(value.slice(cut).trim(), overflowWidth),
	];
};

type Badge = {id: string; width: number; isTag: boolean};

// ' name ' plus the gap to the next badge; '@name' plus that same gap.
const TAG_WIDTH = 3;
const ASSIGNEE_WIDTH = 2;

/** As many badges as the row holds, plus how many had to be dropped. */
const fitBadges = (
	badges: Badge[],
	width: number,
): {shown: Badge[]; hidden: number} => {
	const shown: Badge[] = [];
	let used = 0;

	for (const [index, badge] of badges.entries()) {
		const remaining = badges.length - index - 1;
		const markerWidth = remaining > 0 ? String(remaining).length + 1 : 0;

		if (used + badge.width + markerWidth > width) break;

		used += badge.width;
		shown.push(badge);
	}

	return {shown, hidden: badges.length - shown.length};
};

export const TicketListItemUI: React.FC<{
	width: number;
	ticket: Ticket;
	isSelected: boolean;
	isFlashing?: boolean;
}> = ({width, ticket, isSelected, isFlashing = false}) => {
	const flashColor = useFlashColor(isFlashing);
	// own border (2) + padding (2)
	const contentWidth = width - 4;
	// the ref sits on the title row, so the first line stops short of it
	const titleWidth = contentWidth - NODE_REF_LENGTH - 1;

	const [titleLine, titleOverflow] = splitAtWordBoundary(
		sanitizeInlineText(ticket.title),
		titleWidth,
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
	const assignees = getTicketAssignees(ticket).map(contributor => ({
		...contributor,
		name: contributor.name,
	}));

	// a single badge never pushes the others off the row on its own
	const maxNameWidth = Math.max(1, contentWidth - TAG_WIDTH);

	// '[N]' plus one column of air, same form as the compact row's count
	const comments = nodeRepo.getCommentsByIssue(ticket.id);
	const commentsWidth = comments.length
		? String(comments.length).length + 2 + 1
		: 0;

	const {shown, hidden} = fitBadges(
		[
			...tags.map(tag => ({
				id: tag.id,
				isTag: true,
				width: Math.min(tag.name.length, maxNameWidth) + TAG_WIDTH,
			})),
			...assignees.map(assignee => ({
				id: assignee.id,
				isTag: false,
				width:
					Math.min(assignee.name.length, maxNameWidth) +
					ASSIGNEE_WIDTH +
					(hasAuthoredEvents(assignee.id) ? 0 : 1),
			})),
		],
		contentWidth - commentsWidth,
	);

	return (
		<Box
			borderStyle="round"
			height={5}
			flexDirection="column"
			overflow="hidden"
			borderDimColor={!isSelected}
			borderColor={
				isFlashing ? flashColor : isSelected ? theme.accent : theme.secondary
			}
			justifyContent="space-between"
		>
			<Box paddingLeft={1} paddingRight={1} flexDirection="column">
				<Box justifyContent="space-between">
					<Text color={theme.primary}>{titleLine}</Text>
					<Text color={theme.secondary2} dimColor>
						{nodeRef(ticket.id)}
					</Text>
				</Box>
				{titleOverflow && <Text color={theme.primary}>{titleOverflow}</Text>}
				{descriptionLine && (
					<Text color={theme.secondary2} dimColor>
						{descriptionLine}
					</Text>
				)}
			</Box>

			<Box
				flexDirection="row"
				paddingLeft={1}
				paddingRight={1}
				justifyContent="space-between"
			>
				<Box flexDirection="row">
					{shown.map(badge => (
						<Box paddingRight={1} key={badge.id}>
							{badge.isTag ? (
								<TagUI id={badge.id} maxWidth={maxNameWidth} />
							) : (
								<AssigneeUI id={badge.id} maxWidth={maxNameWidth} />
							)}
						</Box>
					))}

					{hidden > 0 && (
						<Text color={theme.secondary2} dimColor>
							+{hidden}
						</Text>
					)}
				</Box>

				{comments.length > 0 && (
					<Text color={theme.accent}>[{comments.length}]</Text>
				)}
			</Box>
		</Box>
	);
};
