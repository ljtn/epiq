import {Box, Text} from 'ink';
import React from 'react';
import {Swimlane, Ticket} from '../lib/types/board.model.js';
import {TicketListItemUI} from './TicketListItem.js';

type Props = {
	items: Swimlane[];
	width: number;
};

export const SwimlaneUI: React.FC<Props> = ({items, width}) => {
	return (
		<Box flexDirection="row">
			{items.map((lane, index) => (
				<React.Fragment key={index}>
					<Box
						flexDirection="column"
						width={width}
						borderStyle="round"
						borderColor={lane.isSelected ? 'green' : 'gray'}
						paddingRight={1}
						paddingLeft={1}
						paddingBottom={1}
					>
						<Box
							borderStyle="round"
							borderColor={'gray'}
							justifyContent="center"
						>
							<Text bold>{lane.name}</Text>
						</Box>

						{lane.children.map((ticket, index) => (
							<TicketListItemUI key={index} ticket={ticket as Ticket} />
						))}
					</Box>
				</React.Fragment>
			))}
		</Box>
	);
};
