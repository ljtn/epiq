import {Box, Text} from 'ink';
import React from 'react';
import {Ticket} from '../model/context.model.js';
import {ScrollBoxUI} from './ScrollBox.js';

type Props = {
	item: Ticket;
	width: number;
	height: number;
};

export const TicketUI: React.FC<Props> = ({item, width, height}) => {
	const description = item.children.find(x => x.name === 'Description');
	const descriptionRows = description?.value?.split('\n').length ?? 1;
	return (
		<Box
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			borderStyle="round"
			width={width}
			minHeight={height}
			borderColor="gray"
		>
			<ScrollBoxUI
				selectedIndex={item.children.findIndex(x => x.isSelected)}
				width={width}
				height={descriptionRows - 8}
				children={item.children.map((child, index) => (
					<Box
						key={index}
						flexDirection="row"
						borderStyle={'round'}
						borderColor={'gray'}
					>
						<Box minWidth={20}>
							<Text color={'gray'}>{child.name}:</Text>
						</Box>
						<Text color={child.isSelected ? 'cyan' : 'white'}>
							{child.value}
						</Text>
					</Box>
				))}
			></ScrollBoxUI>
		</Box>
	);
};
