import {Box} from 'ink';
import React from 'react';
import {NavNodeCtx, Swimlane, Ticket} from '../model/context.model.js';
import {useAppState} from '../state/state.js';
import {SwimlaneUI} from './Swimlane.js';
import {TicketUI} from './TicketUI.js';

type Props = {
	swimlanes: readonly Swimlane[];
};

export const BoardUI: React.FC<Props> = ({swimlanes}) => {
	const {currentNode, selectedIndex, breadCrumb} = useAppState();

	const actionContext = currentNode.context;

	const isTicketContext =
		actionContext === NavNodeCtx.TICKET ||
		actionContext === NavNodeCtx.FIELD_LIST ||
		actionContext === NavNodeCtx.FIELD;

	const isSwimlaneContext =
		actionContext === NavNodeCtx.BOARD || actionContext === NavNodeCtx.SWIMLANE;

	const ticketFromCrumb =
		actionContext === NavNodeCtx.TICKET
			? (currentNode as Ticket)
			: (breadCrumb.find(n => n.context === NavNodeCtx.TICKET) as
					| Ticket
					| undefined);

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
						key={lane.id}
						height={height}
						width={colWidth}
						isSelected={
							currentNode.context === NavNodeCtx.BOARD &&
							selectedIndex === index
						}
						swimlane={lane}
					/>
				))}

			{isTicketContext && ticketFromCrumb && (
				<TicketUI height={height} ticket={ticketFromCrumb} />
			)}
		</Box>
	);
};
