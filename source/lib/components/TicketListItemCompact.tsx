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
	str.length > width ? str.slice(0, Math.max(0, width - 1)) + '…' : str;

type Props = {
	index: number;
	labelWidth: number;
	width: number;
	ticket: Ticket;
	isSelected: boolean;
	isFlashing?: boolean;
	mode: ModeUnion;
};

export const TicketListItemCompactUI: React.FC<Props> = ({
	index,
	labelWidth,
	width,
	ticket,
	isSelected,
	isFlashing = false,
	mode,
}) => {
	const flashColor = useFlashColor(isFlashing);
	const tags = (ticket.props.tags ?? [])
		.map(tag => nodeRepo.getTag(tag))
		.filter((s): s is Tag => Boolean(s));

	const assignees = (ticket.props.assignees ?? [])
		.map(assignee => nodeRepo.getContributor(assignee))
		.map(contributor =>
			contributor
				? {
						...contributor,
						name: contributor.name,
				  }
				: contributor,
		)
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

	const comments = nodeRepo.getCommentsByIssue(ticket.id);
	const commentsWidth = comments.length
		? String(comments.length).length + 2 + paddingRight
		: 0;

	const commentsRendered = comments.length ? (
		<Box paddingRight={paddingRight}>
			<Text color={theme.accent}>[{comments.length}]</Text>
		</Box>
	) : null;

	const badgesWidth = tagsWidth + assigneesWidth + commentsWidth;
	// one column of air between the title and the first badge
	const titleWidth = Math.max(
		1,
		width - labelWidth - badgesWidth - (badgesWidth > 0 ? 1 : 0),
	);

	return (
		<Box justifyContent="space-between">
			<Box>
				<Box width={labelWidth}>
					{isSelected ? (
						<CursorUI isSelected />
					) : (
						<Text color="gray" dimColor>
							{String(index + 1).padStart(labelWidth - 1) + ' '}
						</Text>
					)}
				</Box>

				<Text wrap="truncate" color={color}>
					{truncateWithEllipsis(ticket.title, titleWidth)}
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
