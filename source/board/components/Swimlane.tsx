import {Box, Text} from 'ink';
import React from 'react';
import {Swimlane, TicketListItem} from '../model/context.model.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {TicketListItemUI} from './TicketListItem.js';

type Props = {
	item: Swimlane;
	width: number;
	height: number;
	isSelected: boolean;
};

export const SwimlaneUI: React.FC<Props> = ({
	item,
	isSelected,
	width,
	height,
}) => {
	const isParentOfCurrentContext = isSelected;
	const paddingTop = 4;
	const paddingBottom = 2;
	return (
		<Box
			flexDirection="column"
			width={width}
			borderStyle="round"
			borderColor={'gray'}
			paddingRight={1}
			paddingLeft={1}
			height={height}
		>
			<Box
				borderStyle={'round'}
				borderColor={isParentOfCurrentContext ? 'cyan' : 'white'}
				justifyContent="center"
				borderLeft={false}
				borderTop={false}
				borderRight={false}
			>
				<Text bold color={isParentOfCurrentContext ? 'cyan' : 'white'}>
					{item.name}
				</Text>
			</Box>
			<Box padding={1}>
				<ScrollBoxUI
					selectedIndex={item.children.findIndex(x => x.isSelected)}
					width={width}
					height={height - paddingTop - paddingBottom}
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
