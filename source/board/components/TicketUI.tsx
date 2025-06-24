import {Box, Text} from 'ink';
import React from 'react';
import {Ticket} from '../model/board.model.js';

type Props = {
	item: Ticket;
	width: number;
};

export const TicketUI: React.FC<Props> = ({item, width}) => {
	return (
		<Box
			flexDirection="row"
			padding={1}
			paddingLeft={2}
			borderStyle={'round'}
			width={width}
			minHeight={16}
			borderColor={'gray'}
		>
			<Box flexDirection="row">
				<Box width={20}>
					<Text color={'cyan'}>{'Description: '}</Text>
				</Box>
				<Text>{item.name}</Text>
			</Box>
		</Box>
	);
};
