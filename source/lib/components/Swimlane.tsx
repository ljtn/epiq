import {Box, Text} from 'ink';
import React from 'react';
import {Swimlane} from '../model/context.model.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {TicketListItemUI} from './TicketListItem.js';
import {TicketListItemCompactUI} from './TicketListItemCompact.js';

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
	const compact = true;
	const isFocused = state.currentNode.id === swimlane.id;
	const paddingTop = 4;
	const paddingBottom = 2;
	const listSelectedIndex = isFocused ? state.selectedIndex : -1;
	const title = swimlane.name + ' (' + swimlane.children.length + ')';

	return compact ? (
		// Compact
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
					{isSelected ? ' ⸬ ' : '  '}
				</Text>
				<Text bold color={isSelected ? theme.accent : theme.primary}>
					{title}
				</Text>
			</Box>

			<Box padding={1}>
				{swimlane.children.length > 0 && (
					<ScrollBoxUI
						selectedIndex={listSelectedIndex}
						height={height - paddingTop - paddingBottom}
					>
						{swimlane.children.map((ticket, index) => (
							<TicketListItemCompactUI
								key={ticket.id ?? index}
								width={width}
								ticket={ticket}
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
	) : (
		// Non compact
		<Box
			flexDirection="column"
			width={width}
			borderStyle="round"
			paddingTop={1}
			borderRight={true}
			borderLeft={false}
			borderTop={false}
			borderBottom={false}
			borderColor={theme.secondary}
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
					{isSelected ? ' ⸬ ' : '   '}
				</Text>
				<Text bold color={isSelected ? theme.accent : theme.primary}>
					{title}
				</Text>
			</Box>

			<Box padding={1}>
				{swimlane.children.length > 0 && (
					<ScrollBoxUI
						selectedIndex={listSelectedIndex}
						height={height - paddingTop - paddingBottom}
						itemHeight={4}
					>
						{swimlane.children.map((ticket, index) => (
							<TicketListItemUI
								key={ticket.id ?? index}
								width={width}
								ticket={ticket}
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
