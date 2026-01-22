import React from 'react';
import {Box} from 'ink';
import {appState} from '../../navigation/state/state.js';
import {BoardItemTypes, Swimlane, Ticket} from '../model/board.model.js';
import {SwimlaneUI} from './Swimlane.js';
import {TicketUI} from './TicketUI.js';

type Props = {
	items: Swimlane[];
	width: number;
};

export const BoardContentUI: React.FC<Props> = ({items, width}) => {
	const actionContext = appState?.currentNode?.actionContext as any;

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

			{isTicketContext && appState.currentNode && (
				<TicketUI
					width={width * items.length}
					item={appState.breadCrumb[appState.breadCrumb.length - 1] as Ticket}
				/>
			)}
		</Box>
	);
};
