import {Box} from 'ink';
import React, {useEffect, useMemo} from 'react';
import {materialize} from '../../event/event-materialize.js';
import {formatLogLine} from '../../event/format-log-utils.js';
import {Ticket} from '../model/context.model.js';
import {getRenderedChildren, useAppState} from '../state/state.js';
import {FieldListUI} from './FieldListUI.js';
import {InlineEditor} from './InlineEditor.js';

type Props = {
	ticket: Ticket;
	height: number;
};

const getLogNodeId = (ticketId: string) => `${ticketId}::log`;

export const TicketUI: React.FC<Props> = ({ticket, height}) => {
	const {selectedIndex, currentNode} = useAppState();
	const maxWidth = process.stdout.columns || 120;
	const isInTicket = currentNode.id === ticket.id;
	const logNodeId = useMemo(() => getLogNodeId(ticket.id), [ticket.id]);

	useEffect(() => {
		materialize({
			action: 'add.field',
			payload: {
				id: logNodeId,
				name: 'Log',
				parent: ticket.id,
				val: ticket.log.map(formatLogLine).join('\n'),
			},
		});

		return () => {
			materialize({
				action: 'delete.node',
				payload: {
					id: logNodeId,
				},
			});
		};
	}, [logNodeId, ticket.id]);

	const children = getRenderedChildren(ticket.id);

	const fieldCount = children.reduce(
		(no, {title}) => (title === 'Assignees' || title === 'Tags' ? no + 1 : no),
		0,
	);

	const spacing = 2;
	const fieldListsHeight = fieldCount * 2;
	const commandPromptHeight = 3;
	const editorHeight =
		height - commandPromptHeight - fieldListsHeight - spacing;

	return (
		<Box
			width={maxWidth}
			flexDirection="column"
			paddingRight={1}
			paddingBottom={1}
			minHeight={height}
		>
			{children.map((child, index) => {
				const selected = isInTicket && selectedIndex === index;

				if (child.title === 'Assignees' || child.title === 'Tags') {
					return (
						<FieldListUI
							key={child.id}
							parent={child}
							selected={selected}
							selectedIndex={selectedIndex}
						/>
					);
				}

				if (child.id === logNodeId) {
					return (
						<Box key={child.id} paddingLeft={1}>
							<InlineEditor
								key={child.id}
								id={child.id}
								text={child.props.value ?? ''}
								selected={selected}
								maxWidth={maxWidth}
								selectedIndex={selectedIndex}
								currentNode={currentNode}
								height={editorHeight}
							/>
							{/* <Text color={selected ? theme.accent : theme.secondary}>
								View log
							</Text> */}
						</Box>
					);
				}

				return (
					<InlineEditor
						key={child.id}
						id={child.id}
						text={child.props.value ?? ''}
						selected={selected}
						maxWidth={maxWidth}
						selectedIndex={selectedIndex}
						currentNode={currentNode}
						height={editorHeight}
					/>
				);
			})}
		</Box>
	);
};
