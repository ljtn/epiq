import {Box, Text} from 'ink';
import React from 'react';
import {Ticket} from '../model/board.model.js';

type Props = {
	item: Ticket;
	width: number;
};

export const TicketUI: React.FC<Props> = ({item}) => {
	return (
		<Box flexDirection="row">
			<Text>{'TICKET: ' + item.name}</Text>
		</Box>
	);
};
