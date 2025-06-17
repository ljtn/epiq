import {Box, Text} from 'ink';
import React from 'react';
import {Swimlane} from '../lib/types/board.model.js';
import {TicketListItem} from './TicketListItem.js';

type Props = {
	items: Swimlane[];
	width: number;
	colSeparator: string;
	highlightIndex?: number;
};

export const SwimlaneBox: React.FC<Props> = ({
	items,
	width,
	colSeparator,
	highlightIndex,
}) => {
	return (
		<Box flexDirection="row">
			{items.map((lane, index) => (
				<React.Fragment key={index}>
					<Box
						flexDirection="column"
						width={width}
						borderStyle="round"
						borderColor={index === highlightIndex ? 'green' : 'gray'}
						paddingX={1}
					>
						{/* Swimlane header */}
						<Text bold>
							{index === highlightIndex ? '👉 ' : ''}
							{lane.name}
						</Text>

						{/* Ticket list */}
						{lane.children.map((ticket, ticketIndex) => (
							<TicketListItem key={ticketIndex} name={ticket.name} />
						))}
					</Box>

					{/* Optional column separator */}
					{index < items.length - 1 && (
						<Box width={colSeparator.length}>
							<Text>{colSeparator}</Text>
						</Box>
					)}
				</React.Fragment>
			))}
		</Box>
	);
};
