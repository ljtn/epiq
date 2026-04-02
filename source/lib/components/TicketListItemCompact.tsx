import {Box, Text} from 'ink';
import React from 'react';
import {nodeRepo} from '../../repository/node-repo.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {Ticket} from '../model/context.model.js';
import {theme} from '../theme/themes.js';
import {stringToHslHexColor} from '../utils/color.js';
import {getTagColor} from './Tag.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width - 3) + '...' : str;

type Props = {
	index: number;
	width: number;
	ticket: Ticket;
	isSelected: boolean;
	mode: ModeUnion;
};

export const TicketListItemCompactUI: React.FC<Props> = ({
	width,
	ticket,
	isSelected,
	index,
	mode,
}) => {
	const children = getOrderedChildren(ticket.id);
	const getListValues = (title: 'Tags' | 'Assignees') =>
		children
			.filter(node => node.title === title)
			.flatMap(node => node.props.value?.split('|').map(s => s.trim()) ?? [])
			.filter(x => x);

	const tags = getListValues('Tags').map(nodeRepo.getTag);
	const assignees = getListValues('Assignees').map(nodeRepo.getContributor);

	const paddingRight = 1;
	const tagsWidth = tags.reduce(acc => acc + 2 + paddingRight, 0);

	const tagsRendered = tags.map((tag, i) => (
		<Box key={`${tag}-${i}`} paddingRight={paddingRight}>
			<Text color={getTagColor(tag?.name ?? '')}>■</Text>
		</Box>
	));
	const assigneesRendered = assignees.map((assignee, i) => (
		<Box key={`${assignee}-${i}`} paddingRight={paddingRight}>
			<Text color={stringToHslHexColor(assignee?.name ?? '')}>
				{'@' + assignee?.name.at(0)}
			</Text>
		</Box>
	));

	const color = isSelected
		? theme.accent
		: mode === Mode.MOVE
		? theme.secondary
		: theme.primary;

	return (
		<Box borderBottom justifyContent="space-between">
			<Box>
				{isSelected ? (
					<Text color={color}>{'⸬  '}</Text>
				) : (
					<Text color={theme.secondary}>{index + 1 + '. '}</Text>
				)}
				<Text color={color}>
					{truncateWithEllipsis(ticket.title, width - tagsWidth - 15)}
				</Text>
			</Box>

			<Box>
				{tagsRendered}
				{assigneesRendered}
			</Box>
		</Box>
	);
};
