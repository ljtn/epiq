import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../model/action-map.model.js';
import {Ticket} from '../model/context.model.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {getTagBackgroundColor} from './Tag.js';
import {getTicketFields} from './TicketListItem.js';
import {UserBadgeUI} from './UserBadge.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width - 3) + '...' : str;

export const TicketListItemCompactUI: React.FC<{
	index: number;
	width: number;
	ticket: Ticket;
	isSelected: boolean;
}> = ({width, ticket, isSelected, index}) => {
	const {mode} = useAppState();

	const fields = getTicketFields(ticket);
	const tags = fields['Tags']?.values ?? [];
	const paddingRight = 1;
	const tagsWidth = tags.reduce(acc => (acc += 2 + paddingRight), 0);

	const tagsRendered = tags.flatMap((tag, i) => (
		<Box key={`${tag}-${i}`} paddingRight={paddingRight}>
			<Text color={getTagBackgroundColor(tag)}>■</Text>
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
					{truncateWithEllipsis(ticket.name, width - tagsWidth - 15)}
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
