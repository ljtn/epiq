import {Box, Text} from 'ink';
import React from 'react';
import {Ticket} from '../model/board.model.js';

type Props = {
	item: Ticket;
	width: number;
};

export const TicketUI: React.FC<Props> = ({item, width}) => (
	<Box
		flexDirection="column"
		padding={1}
		paddingLeft={2}
		borderStyle="round"
		width={width}
		minHeight={16}
		borderColor="gray"
	>
		{item.children.map(child => (
			<Box
				key={child.id}
				flexDirection="row"
				borderStyle={'round'}
				borderColor={child.isSelected ? 'cyan' : 'gray'}
				paddingLeft={1}
			>
				<Box width={30}>
					<Text color="cyan">{child.name}:</Text>
				</Box>
				<Text>{child.description}</Text>
			</Box>
		))}
	</Box>
);
