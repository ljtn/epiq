import {Box} from 'ink';
import React from 'react';
import {AppState} from '../model/app-state.model.js';
import {NavNodeCtx, Ticket} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {useAppState} from '../state/state.js';
import {filterMap} from '../utils/array.utils.js';
import {FieldListUI} from './FieldListUI.js';
import {FieldUI} from './FieldUI.js';

type Props = {
	ticket: Ticket;
	height: number;
	nodes: AppState['nodes'];
};

export const TicketUI: React.FC<Props> = ({ticket, height, nodes}) => {
	const {selectedIndex, currentNode} = useAppState();
	const maxWidth = process.stdout.columns || 120;
	const isInTicket = currentNode.id === ticket.id;
	const children = filterMap(ticket.children, id => nodes[id]);
	return (
		<Box
			width={maxWidth}
			flexDirection="column"
			paddingTop={1}
			paddingLeft={1}
			paddingRight={1}
			minHeight={height}
		>
			{children.map((child, index) =>
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
