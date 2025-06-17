import React from 'react';
import {Box, Text} from 'ink';
import {Ticket} from '../lib/types/board.model.js';

export const TicketListItemUI: React.FC<{ticket: Ticket}> = ({
	ticket: {name, id, isSelected},
}) => (
	<Box borderBottom>
		<Text color={isSelected ? 'green' : 'gray'}>{id + ' - ' + name}</Text>
	</Box>
);
