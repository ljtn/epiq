import React from 'react';
import {Box} from 'ink';
import {appState} from '../../navigation/state/state.js';
import {contextMap, Swimlane, Ticket} from '../model/context.model.js';
import {SwimlaneUI} from './Swimlane.js';
import {TicketUI} from './TicketUI.js';

type Props = {
	items: Swimlane[];
};

export const BoardContentUI: React.FC<Props> = ({items}) => {
	const actionContext = appState.currentNode.context;
	const isTicketContext = actionContext === contextMap.TICKET_LIST_ITEM;
	const isSwimlaneContext =
		actionContext === contextMap.BOARD || actionContext === contextMap.SWIMLANE;

	const width = process.stdout.columns || 120;
	const swimlaneMaxWidth = Math.floor(process.stdout.columns / 3);
	const swimlaneDynamicWidth = Math.floor(width / items.length);
	const renderedWidth = swimlaneDynamicWidth * items.length;
	const colWidth = Math.min(renderedWidth, swimlaneMaxWidth);

	const breadCrumbHeight = 1;
	const commandLineHeight = 3;
	const height = process.stdout.rows - breadCrumbHeight - commandLineHeight;

	return (
		<Box flexDirection="row">
			{isSwimlaneContext &&
				items.map((lane, index) => (
					<SwimlaneUI
						key={index}
						height={height}
						width={colWidth}
						isSelected={
							appState.currentNode.context === 'BOARD' &&
							appState.selectedIndex === index
						}
						item={lane}
					/>
				))}

			{isTicketContext && appState.currentNode && (
				<TicketUI
					height={height}
					width={colWidth * items.length}
					item={appState.breadCrumb[appState.breadCrumb.length - 1] as Ticket}
				/>
			)}
		</Box>
	);
};
