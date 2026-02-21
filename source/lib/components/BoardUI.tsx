import {Box} from 'ink';
import React from 'react';
import {contextMap, Swimlane, Ticket} from '../model/context.model.js';
import {appState} from '../navigation/state/state.js';
import {SwimlaneUI} from './Swimlane.js';
import {TicketUI} from './TicketUI.js';

type Props = {
	swimlanes: Swimlane[];
};

export const BoardUI: React.FC<Props> = ({swimlanes}) => {
	const actionContext = appState.currentNode.context;
	const isTicketContext = actionContext === contextMap.TICKET;
	const isSwimlaneContext =
		actionContext === contextMap.BOARD || actionContext === contextMap.SWIMLANE;

	const width = process.stdout.columns || 120;
	const swimlaneMaxWidth = Math.floor(process.stdout.columns / 3);
	const swimlaneDynamicWidth = Math.floor(width / swimlanes.length);
	const renderedWidth = swimlaneDynamicWidth * swimlanes.length;
	const colWidth = Math.min(renderedWidth, swimlaneMaxWidth);

	const breadCrumbHeight = 1;
	const commandLineHeight = 3;
	const height = process.stdout.rows - breadCrumbHeight - commandLineHeight;

	return (
		<Box flexDirection="row" height={height}>
			{isSwimlaneContext &&
				swimlanes.map((lane, index) => (
					<SwimlaneUI
						key={index}
						height={height}
						width={colWidth}
						isSelected={
							appState.currentNode.context === 'BOARD' &&
							appState.selectedIndex === index
						}
						swimlane={lane}
					/>
				))}

			{isTicketContext && appState.currentNode && (
				<TicketUI height={height} ticket={appState.currentNode as Ticket} />
			)}
		</Box>
	);
};
