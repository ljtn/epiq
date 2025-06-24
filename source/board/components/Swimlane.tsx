import {Box, Text} from 'ink';
import React from 'react';
import {Swimlane, TicketListItem} from '../model/board.model.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {TicketListItemUI} from './TicketListItem.js';

type Props = {
	item: Swimlane;
	width: number;
};

export const SwimlaneUI: React.FC<Props> = ({item, width}) => {
	return (
		<Box
			flexDirection="column"
			width={width}
			borderStyle="round"
			borderColor={item.isSelected ? 'green' : 'gray'}
			paddingRight={1}
			paddingLeft={1}
			paddingBottom={1}
			minHeight={15}
		>
			<Box borderStyle="round" borderColor={'gray'} justifyContent="center">
				<Text bold>{item.name}</Text>
			</Box>

			<ScrollBoxUI
				selectedIndex={item.children.findIndex(x => x.isSelected)}
				width={width}
				size={10}
				children={item.children.map((ticket, index) => (
					<TicketListItemUI
						key={index}
						width={width}
						ticket={ticket as TicketListItem}
					/>
				))}
			></ScrollBoxUI>
		</Box>
	);
};
