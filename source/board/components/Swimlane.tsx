import {Box, Text} from 'ink';
import React from 'react';
import {Swimlane, Ticket} from '../model/board.model.js';
import {TicketListItemUI} from './TicketListItem.js';
import {ScrollBoxUI} from './ScrollBox.js';

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
						minHeight={15}
					>
						<Box
							borderStyle="round"
							borderColor={'gray'}
							justifyContent="center"
						>
							<Text bold>{lane.name}</Text>
						</Box>

						<ScrollBoxUI
							selectedIndex={lane.children.findIndex(x => x.isSelected)}
							width={width}
							size={10}
							children={lane.children.map((ticket, index) => (
								<TicketListItemUI
									key={index}
									width={width}
									ticket={ticket as Ticket}
								/>
							))}
						></ScrollBoxUI>
					</Box>
				</React.Fragment>
			))}
		</Box>
	);
};
