import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {AnyContext, isTicketNode, Swimlane} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {CursorUI} from './Cursor.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {TicketListItemUI} from './TicketListItem.js';
import {TicketListItemCompactUI} from './TicketListItemCompact.js';
import {useFlashColor} from './useFlashColor.js';

type Props = {
	swimlane: Swimlane;
	width: number;
	height: number;
	isSelected: boolean;
	isDense: boolean;
	isFocused: boolean;
	listSelectedIndex: number;
	mode: ModeUnion;
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
}) => {
	const {renderedChildrenIndex, replay} = useAppState();
	const children = renderedChildrenIndex[swimlane.id] ?? [];
	const flashIds = replay ? new Set(replay.flashNodeIds) : null;
	const isSwimlaneFlashing = flashIds?.has(swimlane.id) ?? false;
	const flashColor = useFlashColor(isSwimlaneFlashing);
	const title = `${swimlane.title} ${chalk
		.hex(theme.secondary2)
		.dim('(' + children.length + ')')}`;
	const cmdInputHeight = 3;

	const itemHeight = isDense ? 1 : 5;
	const isLaneCursorActive = isFocused && listSelectedIndex === -1;
	// lane border + padding (4) + scrollbar column (1) + active cursor (2)
	const itemWidth = width - (isLaneCursorActive ? 7 : 5);
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
			<CursorUI isSelected={isSelected}></CursorUI>
			<Text
				bold
				color={
					isSwimlaneFlashing
						? flashColor
						: isSelected
						? theme.accent
						: theme.primary
				}
			>
				{title} {swimlane.readonly ? '🔒' : ''}
			</Text>
		</Box>
	);

	const renderItem = (ticket: NavNode<AnyContext>, index: number) => {
		const isItemSelected = isFocused && listSelectedIndex === index;
		if (!isTicketNode(ticket)) return null;

		const isFlashing = flashIds?.has(ticket.id) ?? false;

		return isDense ? (
			<TicketListItemCompactUI
				key={ticket.id}
				index={index}
				width={width}
				ticket={ticket}
				isSelected={isItemSelected}
				isFlashing={isFlashing}
				mode={mode}
			/>
		) : (
			<TicketListItemUI
				key={ticket.id}
				width={itemWidth}
				ticket={ticket}
				isSelected={isItemSelected}
				isFlashing={isFlashing}
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
				{children.length > 0 && (
					<ScrollBoxUI
						selectedIndex={listSelectedIndex}
						height={contentHeight}
						itemHeight={itemHeight}
					>
						{children.map(renderItem)}
					</ScrollBoxUI>
				)}

				{isLaneCursorActive && <CursorUI isSelected></CursorUI>}
			</Box>
		</Box>
	);
};

export const SwimlaneUI = React.memo(SwimlaneUIComponent);
