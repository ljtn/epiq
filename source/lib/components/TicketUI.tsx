import {Box} from 'ink';
import React from 'react';
import {Ticket} from '../model/context.model.js';
import {useAppState} from '../state/state.js';
import {FieldUI} from './FieldUI.js';

type Props = {
	ticket: Ticket;
	height: number;
};

export const TicketUI: React.FC<Props> = ({ticket, height}) => {
	const {selectedIndex} = useAppState();
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
				<FieldUI key={index} field={child} selected={selectedIndex === index} />
			))}
		</Box>
	);
};
