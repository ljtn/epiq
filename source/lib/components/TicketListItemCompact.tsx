import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {nodeRepo} from '../repository/node-repo.js';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {Contributor, Tag} from '../model/app-state.model.js';
import {Ticket} from '../model/context.model.js';
import {getRenderedChildren} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {getStringColor, stringToHslHexColor} from '../utils/color.js';
import {CursorUI} from './Cursor.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width) + '...' : str;

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
	const children = getRenderedChildren(ticket.id);

	const getReferencedIds = (title: 'Tags' | 'Assignees') => {
		const fieldNode = children.find(node => node.title === title);
		if (!fieldNode) return [];

		return getRenderedChildren(fieldNode.id)
			.map(node =>
				typeof node.props?.value === 'string' ? node.props.value : '',
			)
			.filter((x): x is string => Boolean(x));
	};

	const tags = getReferencedIds('Tags')
		.map(tagId => nodeRepo.getTag(tagId))
		.filter((s): s is Tag => Boolean(s));

	const assignees = getReferencedIds('Assignees')
		.map(contributorId => nodeRepo.getContributor(contributorId))
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

	const color = isSelected
		? theme.accent
		: mode === Mode.MOVE
		? theme.secondary
		: theme.primary;

	return (
		<Box borderBottom justifyContent="space-between">
			<Box>
				<CursorUI
					isSelected={isSelected}
					placeholder={chalk.dim.gray(index + 1 + ' ')}
				></CursorUI>
				<Text wrap="truncate" color={color}>
					{truncateWithEllipsis(
						ticket.title,
						width - tagsWidth - assigneesWidth - 14,
					)}
				</Text>
			</Box>

			<Box>
				{tagsRendered}
				{assigneesRendered}
			</Box>
		</Box>
	);
};
