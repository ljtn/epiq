import {Box, Text} from 'ink';
import React from 'react';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {AppState} from '../model/app-state.model.js';
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
	nodes: AppState['nodes'];
	children: string[];
};

export const TicketListItemCompactUI: React.FC<Props> = ({
	width,
	ticket,
	isSelected,
	index,
	mode,
	nodes,
	children,
}) => {
	const c = (children ?? []).map(x => nodes[x]).filter(x => x != undefined);

	const tags = c
		.filter(x => x.title === 'Tags' && x.props.value)
		.flatMap(({props}) =>
			Array.isArray(props.value?.length) ? props.value : undefined,
		)
		.filter(x => x !== undefined);

	logger.debug(tags);

	const assignees = c
		.filter(x => x.title === 'Assignees' && x.props.value)
		.flatMap(({props}) =>
			Array.isArray(props.value?.length) ? props.value : undefined,
		)
		.filter(x => x !== undefined);

	const paddingRight = 1;
	const tagsWidth = tags.reduce(acc => acc + 2 + paddingRight, 0);

	const tagsRendered = tags.map((tag, i) => (
		<Box key={`${tag}-${i}`} paddingRight={paddingRight}>
			<Text color={getTagColor(tag)}>■</Text>
		</Box>
	));
	const assigneesRendered = assignees.map((assignee, i) => (
		<Box key={`${assignee}-${i}`} paddingRight={paddingRight}>
			<Text color={stringToHslHexColor(assignee)}>{'@' + assignee.at(0)}</Text>
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
