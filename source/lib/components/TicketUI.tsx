import {Box} from 'ink';
import React from 'react';
import {Ticket} from '../model/context.model.js';
import {appState} from '../state/state.js';
import {TicketFieldUI} from './TicketField.js';

type Props = {
	ticket: Ticket;
	height: number;
};

export const TicketUI: React.FC<Props> = ({ticket, height}) => {
	const maxWidth = process.stdout.columns || 120;
	return (
		<Box
			width={maxWidth}
			flexDirection="column"
			paddingTop={1}
			paddingLeft={1}
			paddingRight={1}
			minHeight={height}
		>
			{ticket.children.map((child, index) => (
				<TicketFieldUI
					key={index}
					field={child}
					selected={appState.selectedIndex === index}
				></TicketFieldUI>
			))}
		</Box>
	);
};
