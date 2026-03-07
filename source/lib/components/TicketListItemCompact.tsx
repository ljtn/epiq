import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../model/action-map.model.js';
import {Ticket} from '../model/context.model.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width - 3) + '...' : str;

export const TicketListItemCompactUI: React.FC<{
	width: number;
	ticket: Ticket;
	isSelected: boolean;
}> = ({width, ticket, isSelected}) => {
	const {mode} = useAppState();

	const color = isSelected
		? theme.accent
		: mode === Mode.MOVE
		? theme.secondary
		: theme.primary;

	return (
		<Box borderBottom>
			<Text color={color}>{isSelected ? '⸬ ' : '  '}</Text>
			<Text color={color}>{truncateWithEllipsis(ticket.name, width - 10)}</Text>
		</Box>
	);
};
