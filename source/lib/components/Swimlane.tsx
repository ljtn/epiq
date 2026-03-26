import {Box, Text} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {AppState} from '../model/app-state.model.js';
import {Swimlane} from '../model/context.model.js';
import {theme} from '../theme/themes.js';
import {filterMap} from '../utils/array.utils.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {TicketListItemUI} from './TicketListItem.js';
import {TicketListItemCompactUI} from './TicketListItemCompact.js';

type Props = {
	swimlane: Swimlane;
	width: number;
	height: number;
	isSelected: boolean;
	isDense: boolean;
	isFocused: boolean;
	listSelectedIndex: number;
	mode: ModeUnion;
	nodes: AppState['nodes'];
};

const SwimlaneUIComponent: React.FC<Props> = ({
	swimlane,
	isSelected,
	width,
	height,
	isDense,
	isFocused,
	listSelectedIndex,
	mode,
	nodes,
}) => {
	const title = `${swimlane.title} (${swimlane.children.length})`;
	const cmdInputHeight = 3;

	const itemHeight = isDense ? 1 : 4;
	const contentHeight = height - cmdInputHeight - (isDense ? 2 : 1);

	const swimlaneHeading = (
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
				{title}
			</Text>
		</Box>
	);

	const renderItem = (ticket: any, index: number) => {
		const isItemSelected = isFocused && listSelectedIndex === index;

		return isDense ? (
			<TicketListItemCompactUI
				key={ticket.id}
				index={index}
				width={width}
				ticket={ticket}
				isSelected={isItemSelected}
				mode={mode}
			/>
		) : (
			<TicketListItemUI
				key={ticket.id}
				width={width}
				ticket={ticket}
				isSelected={isItemSelected}
			/>
		);
	};

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
			{swimlaneHeading}

			<Box padding={isDense ? 1 : 0}>
				{swimlane.children.length > 0 && (
					<ScrollBoxUI
						selectedIndex={listSelectedIndex}
						height={contentHeight}
						itemHeight={itemHeight}
					>
						{filterMap(swimlane.children, id => nodes[id]).map(renderItem)}
					</ScrollBoxUI>
				)}

				{isFocused && listSelectedIndex === -1 && (
					<Text color={theme.accent}>⸬</Text>
				)}
			</Box>
		</Box>
	);
};

export const SwimlaneUI = React.memo(SwimlaneUIComponent);
