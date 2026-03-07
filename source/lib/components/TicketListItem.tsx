import {Box, Text} from 'ink';
import React from 'react';
import {Ticket} from '../model/context.model.js';
import {theme} from '../theme/themes.js';
import {TagUI} from './Tag.js';

const truncateWithEllipsis = (str: string, width: number): string => {
	return str.length >= width ? str.slice(0, width - 3) + '...' : str;
};

export const TicketListItemUI: React.FC<{
	width: number;
	ticket: Ticket;
	isSelected: boolean;
}> = ({width, ticket, isSelected}) => {
	return (
		<Box
			borderStyle={'round'}
			width={width - 5}
			borderColor={isSelected ? theme.accent : theme.secondary}
			flexDirection="column"
		>
			<Box borderBottom>
				{/* <Text color={color}>{isSelected ? ' ⸬' : '  '}</Text> */}
				<Box paddingLeft={1}>
					<Text color={theme.primary}>
						{truncateWithEllipsis(ticket.name, width - 12)}
					</Text>
				</Box>
			</Box>
			<Box flexDirection="row" paddingLeft={0}>
				<Box paddingLeft={1}>
					<TagUI name={'urgent'}></TagUI>
				</Box>
				<Box paddingLeft={1}>
					<TagUI name={'urgent'}></TagUI>
				</Box>
			</Box>
		</Box>
	);
};
