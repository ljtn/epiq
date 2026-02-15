import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../navigation/model/action-map.model.js';
import {appState} from '../navigation/state/state.js';
import {TicketListItem} from '../model/context.model.js';
import {theme} from '../theme/themes.js';

const truncateWithEllipsis = (str: string, width: number): string =>
	str.length >= width ? str.slice(0, width - 3) + '...' : str;

export const TicketListItemUI: React.FC<{
	width: number;
	ticket: TicketListItem;
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
			{truncateWithEllipsis(ticket.name, width - 6)}
		</Text>
	</Box>
);
