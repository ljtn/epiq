import {Box} from 'ink';
import React from 'react';
import {NavNodeCtx, Swimlane, Ticket} from '../model/context.model.js';
import {getState} from '../state/state.js';
import {SwimlaneUI} from './Swimlane.js';
import {TicketUI} from './TicketUI.js';

type Props = {
	swimlanes: readonly Swimlane[];
};

export const BoardUI: React.FC<Props> = ({swimlanes}) => {
	const actionContext = getState().currentNode.context;
	const isTicketContext = actionContext === NavNodeCtx.TICKET;
	const isSwimlaneContext =
		actionContext === NavNodeCtx.BOARD || actionContext === NavNodeCtx.SWIMLANE;

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
							getState().currentNode.context === 'BOARD' &&
							getState().selectedIndex === index
						}
						swimlane={lane}
					/>
				))}

			{isTicketContext && getState().currentNode && (
				<TicketUI height={height} ticket={getState().currentNode as Ticket} />
			)}
		</Box>
	);
};
