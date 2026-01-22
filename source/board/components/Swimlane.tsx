import {Box, Text} from 'ink';
import React from 'react';
import {Swimlane, TicketListItem} from '../model/board.model.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {TicketListItemUI} from './TicketListItem.js';
import {appState} from '../../navigation/state/state.js';

type Props = {
	item: Swimlane;
	width: number;
};

export const SwimlaneUI: React.FC<Props> = ({item, width}) => {
	const color = appState.currentNode?.id === item.id ? 'cyan' : 'gray';
	return (
		<Box
			flexDirection="column"
			width={width}
			borderStyle="round"
			borderColor={'gray'}
			paddingRight={1}
			paddingLeft={1}
			minHeight={15}
			height={20}
		>
			<Box borderStyle="round" borderColor={color} justifyContent="center">
				<Text bold>{item.name}</Text>
			</Box>
			<Box padding={1}>
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
		</Box>
	);
};
