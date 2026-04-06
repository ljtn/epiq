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

	const fieldCount = children.reduce(
		(no, {title}) => (title === 'Assignees' || title === 'Tags' ? ++no : no),
		0,
	);
	const labelHeight = 1;
	const fieldListsHeight = fieldCount * 5;
	const commandPromptHeight = 3;
	const descriptionHeight =
		height - commandPromptHeight - fieldListsHeight - labelHeight;

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
				child.title === 'Assignees' || child.title === 'Tags' ? (
					<FieldListUI
						key={child.id}
						items={child.props.value?.split('|').map(s => s.trim()) ?? []}
						title={child.title}
						selected={isInTicket && selectedIndex === index}
					/>
				) : (
					<FieldUI
						height={descriptionHeight}
						key={child.id}
						field={child as NavNode<'FIELD'>}
						selected={
							(isInTicket && selectedIndex === index) ||
							currentNode.id === child.id
						}
						selectedIndex={selectedIndex}
						currentNode={currentNode}
					/>
				),
			)}
		</Box>
	);
};
