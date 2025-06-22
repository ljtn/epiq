import React from 'react';
import {Box, Text} from 'ink';
import {Ticket} from '../model/board.model.js';
import {navigationState} from '../../navigation/state/state.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width - 3) + '...' : str;

export const TicketListItemUI: React.FC<{width: number; ticket: Ticket}> = ({
	width,
	ticket: {name, id, isSelected},
}) => (
	<Box borderBottom>
		<Text
			color={
				isSelected && navigationState.mode === 'move'
					? 'white'
					: isSelected
					? 'green'
					: navigationState.mode === 'move'
					? 'gray'
					: 'white'
			}
		>
			{truncateWithEllipsis(id + ' - ' + name, width - 5)}
		</Text>
	</Box>
);
