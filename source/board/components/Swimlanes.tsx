import React from 'react';
import {Box} from 'ink';
import {navigationState} from '../../navigation/state/state.js';
import {BoardItemTypes, Swimlane, Ticket} from '../model/board.model.js';
import {SwimlaneUI} from './Swimlane.js';
import {TicketUI} from './TicketUI.js';

type Props = {
	items: Swimlane[];
	width: number;
};

export const BoardContentUI: React.FC<Props> = ({items, width}) => {
	const actionContext = navigationState?.currentNode?.actionContext as any;

	const isSwimlaneContext = [
		undefined,
		BoardItemTypes.BOARD,
		BoardItemTypes.SWIMLANE,
		BoardItemTypes.TICKET_LIST_ITEM,
	].includes(actionContext);

	const isTicketContext = actionContext === BoardItemTypes.TICKET;

	return (
		<Box flexDirection="row">
			{isSwimlaneContext &&
				items.map((lane, index) => (
					<SwimlaneUI key={index} width={width} item={lane} />
				))}

			{isTicketContext && navigationState.currentNode && (
				<TicketUI
					width={width * items.length}
					item={
						navigationState.breadCrumb[
							navigationState.breadCrumb.length - 1
						] as Ticket
					}
				/>
			)}
		</Box>
	);
};
