import {Box, Text} from 'ink';
import React, {useEffect, useMemo} from 'react';
import {formatLogLine} from '../../event/format-log-utils.js';
import {nodeRepo} from '../../repository/node-repo.js';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {AnyContext, Ticket} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {nodes} from '../state/node-builder.js';
import {getRenderedChildren, useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {CursorUI} from './Cursor.js';
import {FieldListUI} from './FieldListUI.js';
import {InlineEditor} from './InlineEditor.js';

type Props = {
	ticket: Ticket;
	height: number;
};

const getLogNodeId = (ticketId: string) => `${ticketId}::log`;

const isFieldListNode = (title?: string) =>
	title === 'Assignees' || title === 'Tags';

export const TicketUI: React.FC<Props> = ({ticket, height}) => {
	const {selectedIndex, currentNode} = useAppState();
	const maxWidth = process.stdout.columns || 120;

	const logNodeId = useMemo(() => getLogNodeId(ticket.id), [ticket.id]);

	const logText = useMemo(
		() => [...ticket.log].reverse().map(formatLogLine).join('\n'),
		[ticket.log],
	);

	useEffect(() => {
		const existing = nodeRepo.getNode(logNodeId);
		if (existing) return;

		const logNode: NavNode<AnyContext> = {
			...nodes.field(logNodeId, 'Log', ticket.id, {
				value: logText,
			}),
			readonly: true,
			childRenderAxis: 'vertical',
		};

		nodeRepo.createNodeAtPosition(logNode);

		return () => {
			nodeRepo.deleteNode(logNodeId);
		};
	}, [logNodeId, ticket.id, logText]);

	useEffect(() => {
		const existing = nodeRepo.getNode(logNodeId);
		if (!existing) return;

		if (existing.props.value !== logText) {
			nodeRepo.updateNode({
				...existing,
				props: {
					...existing.props,
					value: logText,
				},
				childRenderAxis: 'vertical',
				readonly: true,
			});
		}
	}, [logNodeId, logText]);

	const isAtTicketRoot = currentNode.id === ticket.id;
	const isInsideLog =
		currentNode.id === logNodeId || currentNode.parentNodeId === logNodeId;

	useEffect(() => {
		if (!isInsideLog) return;
		if (selectedIndex >= 0) return;

		navigationUtils.navigate({selectedIndex: 0});
	}, [isInsideLog, selectedIndex]);

	const children = getRenderedChildren(ticket.id);

	if (isInsideLog) {
		const logNode = nodeRepo.getNode(logNodeId);

		const commandPromptHeight = 3;
		const editorHeight = height - commandPromptHeight;

		return (
			<Box
				width={maxWidth}
				flexDirection="column"
				paddingRight={1}
				paddingBottom={1}
				minHeight={height}
			>
				{logNode ? (
					<InlineEditor
						id={logNode.id}
						label="Event log"
						text={logNode.props.value ?? ''}
						selected={false}
						maxWidth={maxWidth}
						height={editorHeight}
					/>
				) : null}
			</Box>
		);
	}

	const fieldCount = children.reduce(
		(count, child) =>
			isFieldListNode(child.title) || child.id === logNodeId
				? count + 1
				: count,
		0,
	);

	const spacing = 2;
	const fieldListsHeight = fieldCount * 1;
	const commandPromptHeight = 3;
	const editorHeight =
		height - commandPromptHeight - fieldListsHeight - spacing;

	const renderNode = (
		child: ReturnType<typeof getRenderedChildren>[number],
		selected: boolean,
	) => {
		if (isFieldListNode(child.title)) {
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
				<Box key={child.id} paddingTop={1}>
					<CursorUI isSelected={selected} />
					<Text
						backgroundColor={theme.secondary}
						color={selected ? theme.accent : theme.primary}
					>
						{' History ›› '}
					</Text>
				</Box>
			);
		}

		if (child.title === 'Description') {
			return (
				<InlineEditor
					label="Description (press e to edit)"
					key={child.id}
					id={child.id}
					text={child.props.value ?? ''}
					selected={selected}
					maxWidth={maxWidth}
					height={editorHeight}
				/>
			);
		}

		return null;
	};

	return (
		<Box
			width={maxWidth}
			flexDirection="column"
			paddingRight={1}
			paddingBottom={1}
			minHeight={height}
		>
			{children.map((child, index) =>
				renderNode(child, isAtTicketRoot && selectedIndex === index),
			)}
		</Box>
	);
};
