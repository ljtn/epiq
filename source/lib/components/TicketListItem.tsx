import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../model/action-map.model.js';
import {appState} from '../state/state.js';
import {Ticket} from '../model/context.model.js';
import {theme} from '../theme/themes.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width - 3) + '...' : str;

export const TicketListItemUI: React.FC<{
	width: number;
	ticket: Ticket;
}> = ({width, ticket}) => (
	<Box borderBottom>
		<Text
			color={
				ticket.isSelected && appState.mode === Mode.MOVE
					? theme.accent
					: ticket.isSelected
					? theme.accent
					: appState.mode === Mode.MOVE
					? theme.secondary
					: theme.primary
			}
		>
			{ticket.isSelected ? '⸬ ' : '  '}
		</Text>
		<Text
			color={
				ticket.isSelected && appState.mode === Mode.MOVE
					? theme.accent
					: ticket.isSelected
					? theme.accent
					: appState.mode === Mode.MOVE
					? theme.secondary
					: theme.primary
			}
		>
			{truncateWithEllipsis(ticket.fields['title'], width - 6)}
		</Text>
	</Box>
);
