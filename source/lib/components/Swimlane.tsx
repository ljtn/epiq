import {Box, Text} from 'ink';
import React from 'react';
import {Swimlane, Ticket} from '../model/context.model.js';
import {appState} from '../state/state.js';
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
	const isParentOfCurrentContext = isSelected;
	const paddingTop = 4;
	const paddingBottom = 2;
	return (
		<Box
			flexDirection="column"
			width={width}
			borderStyle="round"
			borderColor={isParentOfCurrentContext ? theme.accent : theme.secondary}
			paddingRight={1}
			paddingLeft={1}
			height={height}
		>
			<Box
				borderStyle={'round'}
				borderColor={theme.secondary}
				justifyContent="flex-start"
				borderLeft={false}
				borderTop={false}
				borderRight={false}
			>
				<Text
					bold
					color={isParentOfCurrentContext ? theme.accent : theme.primary}
				>
					{swimlane.isSelected ? '⸬ ' : '  '}
				</Text>
				<Text
					bold
					color={isParentOfCurrentContext ? theme.accent : theme.primary}
				>
					{swimlane.fields['title']}
				</Text>
			</Box>
			<Box padding={1}>
				{swimlane.children.length > 0 && (
					<ScrollBoxUI
						selectedIndex={swimlane.children.findIndex(x => x.isSelected)}
						width={width}
						height={height - paddingTop - paddingBottom}
						children={swimlane.children.map((ticket, index) => (
							<TicketListItemUI
								key={index}
								width={width}
								ticket={ticket as Ticket}
							/>
						))}
					></ScrollBoxUI>
				)}
				{appState.currentNode.id === swimlane.id &&
					appState.selectedIndex === -1 && (
						<Text color={theme.accent}>{'⸬'}</Text>
					)}
			</Box>
		</Box>
	);
};
