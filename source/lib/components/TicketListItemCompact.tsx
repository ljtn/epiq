import {Box, Text} from 'ink';
import React from 'react';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {Contributor, Tag} from '../model/app-state.model.js';
import {Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {theme} from '../theme/themes.js';
import {getStringColor, stringToHslHexColor} from '../utils/color.js';
import {CursorUI} from './Cursor.js';
import {useFlashColor} from './useFlashColor.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width) + '...' : str;

type Props = {
	index: number;
	width: number;
	ticket: Ticket;
	isSelected: boolean;
	isFlashing?: boolean;
	mode: ModeUnion;
};

export const TicketListItemCompactUI: React.FC<Props> = ({
	width,
	ticket,
	isSelected,
	isFlashing = false,
	index,
	mode,
}) => {
	const flashColor = useFlashColor(isFlashing);
	const tags = (ticket.props.tags ?? [])
		.map(tag => nodeRepo.getTag(tag))
		.filter((s): s is Tag => Boolean(s));

	const assignees = (ticket.props.assignees ?? [])
		.map(assignee => nodeRepo.getContributor(assignee))
		.filter((s): s is Contributor => Boolean(s));

	const paddingRight = 1;
	const tagsWidth = tags.length * (1 + paddingRight);
	const assigneesWidth = assignees.length * (2 + paddingRight);

	const tagsRendered = tags.map(tag => (
		<Box key={tag.id} paddingRight={paddingRight}>
			<Text color={getStringColor(tag.name)}>■</Text>
		</Box>
	));

	const assigneesRendered = assignees.map(assignee => (
		<Box key={assignee.id} paddingRight={paddingRight}>
			<Text color={stringToHslHexColor(assignee.name)}>
				{'@' + assignee.name.at(0)}
			</Text>
		</Box>
	));

	const color = isFlashing
		? flashColor
		: isSelected
		? theme.accent
		: mode === Mode.MOVE
		? theme.secondary
		: theme.primary;

	const INDEX_WIDTH = 4;

	const comments = nodeRepo.getCommentsByIssue(ticket.id);
	const commentsWidth = comments.length
		? String(comments.length).length + 2 + paddingRight
		: 0;

	const commentsRendered = comments.length ? (
		<Box paddingRight={paddingRight}>
			<Text color={theme.accent}>[{comments.length}]</Text>
		</Box>
	) : null;

	return (
		<Box borderBottom justifyContent="space-between">
			<Box>
				<Box width={INDEX_WIDTH}>
					{isSelected ? (
						<CursorUI isSelected={isSelected} />
					) : (
						<Text color="gray" dimColor>
							{index + 1}
						</Text>
					)}
				</Box>

				<Text wrap="truncate" color={color}>
					{truncateWithEllipsis(
						ticket.title,
						width - tagsWidth - assigneesWidth - commentsWidth - 18,
					)}
				</Text>
			</Box>

			<Box>
				{tagsRendered}
				{assigneesRendered}
				{commentsRendered}
			</Box>
		</Box>
	);
};
