import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../model/action-map.model.js';
import {Ticket} from '../model/context.model.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {getTicketFields} from './TicketListItem.js';
import {TagUI} from './Tag.js';
import {UserBadgeUI} from './UserBadge.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width - 3) + '...' : str;

export const TicketListItemCompactUI: React.FC<{
	width: number;
	ticket: Ticket;
	isSelected: boolean;
}> = ({width, ticket, isSelected}) => {
	const {mode} = useAppState();

	const fields = getTicketFields(ticket);
	const tags = fields['Tags']?.values ?? [];
	const paddingRight = 1;
	const tagsWidth = tags.reduce(
		(acc, curr) => (acc += curr.length + paddingRight),
		0,
	);

	const tagsRendered = tags.flatMap((tag, index) => (
		<Box key={`${tag}-${index}`} paddingRight={paddingRight}>
			<TagUI name={tag} />
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
				<Text color={color}>{isSelected ? '⸬ ' : '  '}</Text>
				<Text color={color}>
					{truncateWithEllipsis(ticket.name, width - tagsWidth - 14)}
				</Text>
			</Box>
			<Box>
				{tagsRendered}

				<UserBadgeUI
					isSelected={isSelected}
					user={{initials: 'JL'}}
				></UserBadgeUI>
			</Box>
		</Box>
	);
};
