import {Box} from 'ink';
import React from 'react';
import {Ticket} from '../model/context.model.js';
import {appState} from '../navigation/state/state.js';
import {TicketFieldUI} from './TicketField.js';

type Props = {
	ticket: Ticket;
	height: number;
};

export const TicketUI: React.FC<Props> = ({ticket, height}) => {
	return (
		<Box
			flexDirection="column"
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
