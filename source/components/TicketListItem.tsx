import React from 'react';
import {Box, Text} from 'ink';
import {Ticket} from '../lib/types/board.model.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width - 3) + '...' : str;

export const TicketListItemUI: React.FC<{width: number; ticket: Ticket}> = ({
	width,
	ticket: {name, id, isSelected},
}) => (
	<Box borderBottom>
		<Text color={isSelected ? 'green' : 'gray'}>
			{truncateWithEllipsis(id + ' - ' + name, width - 5)}
		</Text>
	</Box>
);
