import {Box} from 'ink';
import React from 'react';
import {getOrderedChildren} from '../../repository/rank.js';
import {Ticket} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {useAppState} from '../state/state.js';
import {FieldListUI} from './FieldListUI.js';
import {FieldUI} from './FieldUI.js';

type Props = {
	ticket: Ticket;
	height: number;
};

export const TicketUI: React.FC<Props> = ({ticket, height}) => {
	const {selectedIndex, currentNode} = useAppState();
	const maxWidth = process.stdout.columns || 120;
	const isInTicket = currentNode.id === ticket.id;
	const children = getOrderedChildren(ticket.id);
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
				Array.isArray(child.props.value) ? (
					<FieldListUI
						key={child.id}
						items={child.props.value}
						title={child.title}
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
