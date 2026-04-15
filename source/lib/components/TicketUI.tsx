import {Box, Text} from 'ink';
import React, {useEffect, useMemo} from 'react';
import {nodeRepo} from '../../repository/node-repo.js';
import {Ticket} from '../model/context.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {nodes} from '../state/node-builder.js';
import {getRenderedChildren, useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {FieldListUI} from './FieldListUI.js';
import {InlineEditor} from './InlineEditor.js';
import {formatLogLine} from '../../event/format-log-utils.js';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import chalk from 'chalk';
import {CursorUI} from './Cursor.js';

type Props = {
	ticket: Ticket;
	height: number;
};

const getLogNodeId = (ticketId: string) => `${ticketId}::log`;

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
	}, [logNodeId, ticket.id]);

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
			child.title === 'Assignees' ||
			child.title === 'Tags' ||
			child.id === logNodeId
				? count + 1
				: count,
		0,
	);

	const spacing = 2;
	const fieldListsHeight = fieldCount * 2;
	const commandPromptHeight = 3;
	const editorHeight =
		height - commandPromptHeight - fieldListsHeight - spacing;

	const renderNode = (
		child: ReturnType<typeof getRenderedChildren>[number],
		selected: boolean,
	) => {
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
				<Box key={child.id} paddingTop={1}>
					<CursorUI isSelected={selected}></CursorUI>
					<Text
						backgroundColor={theme.secondary}
						color={selected ? theme.accent : theme.secondary}
					>
						{' ' + 'History ››' + ' '}
					</Text>
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
				height={editorHeight}
			/>
		);
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
