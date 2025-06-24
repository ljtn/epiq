import React from 'react';
import {Box, Text} from 'ink';
import {TicketListItem} from '../model/board.model.js';
import {navigationState} from '../../navigation/state/state.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width - 3) + '...' : str;

export const TicketListItemUI: React.FC<{
	width: number;
	ticket: TicketListItem;
}> = ({width, ticket}) => (
	<Box borderBottom>
		<Text
			color={
				ticket.isSelected && navigationState.mode === 'move'
					? 'white'
					: ticket.isSelected
					? 'green'
					: navigationState.mode === 'move'
					? 'gray'
					: navigationState.breadCrumb.includes(ticket)
					? 'yellow'
					: 'white'
			}
		>
			{truncateWithEllipsis(ticket.id + ' - ' + name, width - 6)}
		</Text>
	</Box>
);
