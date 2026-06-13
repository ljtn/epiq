import {Box, Text} from 'ink';
import React, {useMemo} from 'react';
import {isFieldListNode, isFieldNode, Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getRenderedChildren, useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {virtualNodeId} from '../virtual-nodes/virtual-ids.js';
import {CursorUI} from './Cursor.js';
import {FieldListUI} from './FieldListUI.js';
import {InlineEditor} from './InlineEditor.js';
import {CommentListUI} from './CommentListUI.js';
import {getVisibleCommentCount} from '../utils/comment.utils.js';

type Props = {
	ticket: Ticket;
	height: number;
};

const getDescriptionNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'description');

const getCommentsNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'comments');

const getLogNodeId = (ticketId: string) => virtualNodeId(ticketId, 'history');

export const TicketUI: React.FC<Props> = ({ticket, height}) => {
	const commentCount = useMemo(() => getVisibleCommentCount(ticket), [ticket]);
	const {selectedIndex, contextNode} = useAppState();
	const maxWidth = process.stdout.columns || 120;

	const descriptionNodeId = useMemo(
		() => getDescriptionNodeId(ticket.id),
		[ticket.id],
	);

	const commentsNodeId = useMemo(
		() => getCommentsNodeId(ticket.id),
		[ticket.id],
	);

	const logNodeId = useMemo(() => getLogNodeId(ticket.id), [ticket.id]);

	const isAtTicketRoot = contextNode.id === ticket.id;

	const isInsideComments =
		contextNode.id === commentsNodeId ||
		contextNode.parentNodeId === commentsNodeId;

	const isInsideLog =
		contextNode.id === logNodeId || contextNode.parentNodeId === logNodeId;

	const children = getRenderedChildren(ticket.id);

	if (isInsideComments) {
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
				<CommentListUI ticket={ticket} width={maxWidth} height={editorHeight} />
			</Box>
		);
	}

	if (isInsideLog) {
		const logNode = nodeRepo.getNode(logNodeId);
		const logValue =
			logNode && isFieldNode(logNode) ? logNode.props.value ?? '' : '';

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
						text={logValue}
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
			isFieldListNode(child) ||
			child.id === commentsNodeId ||
			child.id === logNodeId
				? count + 1
				: count,
		0,
	);

	const spacing = 2;
	const commandPromptHeight = 3;
	const fieldListsHeight = fieldCount;
	const editorHeight =
		height - commandPromptHeight - fieldListsHeight - spacing;

	const renderNode = (
		child: ReturnType<typeof getRenderedChildren>[number],
		selected: boolean,
	) => {
		if (child.id === descriptionNodeId) {
			return (
				<InlineEditor
					key={child.id}
					id={descriptionNodeId}
					label="Description (press e to edit)"
					text={ticket.props.description ?? ''}
					selected={selected}
					maxWidth={maxWidth}
					height={editorHeight}
				/>
			);
		}

		if (isFieldListNode(child)) {
			return (
				<FieldListUI
					key={child.id}
					parent={child}
					selected={selected}
					selectedIndex={selectedIndex}
				/>
			);
		}

		if (child.id === commentsNodeId) {
			return (
				<Box key={child.id} paddingTop={1}>
					<CursorUI isSelected={selected} />
					<Text
						backgroundColor={theme.secondary}
						color={selected ? theme.accent : theme.primary}
					>
						{` Comments (${commentCount}) ›› `}
					</Text>
				</Box>
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
