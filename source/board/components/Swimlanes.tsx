import {Box} from 'ink';
import React from 'react';
import {navigationState} from '../../navigation/state/state.js';
import {BoardItemTypes, Swimlane, Ticket} from '../model/board.model.js';
import {SwimlaneUI} from './Swimlane.js';
import {TicketUI} from './TicketUI.js';

type Props = {
	items: Swimlane[];
	width: number;
};

export const SwimlanesUI: React.FC<Props> = ({items, width}) => {
	const actionContext = navigationState?.currentNode?.actionContext as any;

	const shouldRenderSwimlanes = [
		undefined,
		BoardItemTypes.BOARD,
		BoardItemTypes.SWIMLANE,
		BoardItemTypes.TICKET_LIST_ITEM,
	].includes(actionContext);

	const shouldRenderTicket =
		!shouldRenderSwimlanes && actionContext === BoardItemTypes.TICKET;

	return (
		<Box flexDirection="row">
			{(shouldRenderTicket && Boolean(navigationState.currentNode)
				? items.filter(lane => navigationState.breadCrumb.includes(lane))
				: items
			).map((lane, index) => (
				<React.Fragment key={index}>
					<SwimlaneUI width={width} item={lane}></SwimlaneUI>
				</React.Fragment>
			))}
			{shouldRenderTicket ? (
				<Box padding={1}>
					<TicketUI
						width={width * 3}
						item={navigationState.currentNode as Ticket}
					></TicketUI>
				</Box>
			) : (
				''
			)}
		</Box>
	);
};
