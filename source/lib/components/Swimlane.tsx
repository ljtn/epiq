import {Box, Text} from 'ink';
import React from 'react';
import {Swimlane, Ticket} from '../model/context.model.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {TicketListItemUI} from './TicketListItem.js';

type Props = {
	swimlane: Swimlane;
	width: number;
	height: number;
	isSelected: boolean;
};

export const SwimlaneUI: React.FC<Props> = ({
	swimlane,
	isSelected,
	width,
	height,
}) => {
	const state = useAppState();

	const isFocused = state.currentNode.id === swimlane.id;

	const paddingTop = 4;
	const paddingBottom = 2;

	const listSelectedIndex = isFocused ? state.selectedIndex : -1;

	return (
		<Box
			flexDirection="column"
			width={width}
			borderStyle="round"
			borderColor={isSelected ? theme.accent : theme.secondary}
			paddingRight={1}
			paddingLeft={1}
			height={height}
		>
			<Box
				borderStyle="round"
				borderColor={theme.secondary}
				justifyContent="flex-start"
				borderLeft={false}
				borderTop={false}
				borderRight={false}
			>
				<Text bold color={isSelected ? theme.accent : theme.primary}>
					{isSelected ? '⸬ ' : '  '}
				</Text>
				<Text bold color={isSelected ? theme.accent : theme.primary}>
					{swimlane.name}
				</Text>
			</Box>

			<Box padding={1}>
				{swimlane.children.length > 0 && (
					<ScrollBoxUI
						selectedIndex={listSelectedIndex}
						width={width}
						height={height - paddingTop - paddingBottom}
					>
						{swimlane.children.map((ticket, index) => (
							<TicketListItemUI
								key={(ticket as Ticket).id ?? index}
								width={width}
								ticket={ticket as Ticket}
								isSelected={isFocused && state.selectedIndex === index}
							/>
						))}
					</ScrollBoxUI>
				)}

				{isFocused && state.selectedIndex === -1 && (
					<Text color={theme.accent}>⸬</Text>
				)}
			</Box>
		</Box>
	);
};
