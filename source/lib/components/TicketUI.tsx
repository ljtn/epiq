import {Box} from 'ink';
import React from 'react';
import {NavNodeCtx, Ticket} from '../model/context.model.js';
import {useAppState} from '../state/state.js';
import {FieldUI} from './FieldUI.js';
import {FieldListUI} from './FieldListUI.js';
import {NavNode} from '../model/navigation-node.model.js';

type Props = {
	ticket: Ticket;
	height: number;
};

export const TicketUI: React.FC<Props> = ({ticket, height}) => {
	const {selectedIndex, currentNode} = useAppState();
	const maxWidth = process.stdout.columns || 120;
	const isInTicket = currentNode.id === ticket.id;
	return (
		<Box
			width={maxWidth}
			flexDirection="column"
			paddingTop={1}
			paddingLeft={1}
			paddingRight={1}
			minHeight={height}
		>
			{ticket.children.map((child, index) =>
				child.context === NavNodeCtx.FIELD_LIST ? (
					<FieldListUI
						key={child.id}
						fieldList={child as NavNode<'FIELD_LIST'>}
						selected={isInTicket && selectedIndex === index}
					/>
				) : (
					<FieldUI
						key={child.id}
						field={child as NavNode<'FIELD'>}
						selected={isInTicket && selectedIndex === index}
					/>
				),
			)}
		</Box>
	);
};
