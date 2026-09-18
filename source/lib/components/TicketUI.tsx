import {Box, Text} from 'ink';
import React, {useMemo} from 'react';
import {isFieldListNode, isFieldNode, Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getRenderedChildren, useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {getVisibleCommentCount} from '../utils/comment.utils.js';
import {virtualNodeId} from '../virtual-nodes/virtual-ids.js';
import {AttachmentListUI} from './AttachmentListUI.js';
import {CommentListUI} from './CommentListUI.js';
import {CursorUI} from './Cursor.js';
import {DiffListUI} from './DiffListUI.js';
import {FieldListUI} from './FieldListUI.js';
import {InlineEditor} from './InlineEditor.js';
import {inlineEditorRowCount} from '../utils/inline-editor-layout.js';

type Props = {
	ticket: Ticket;
	height: number;
};

const getDescriptionNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'description');

const getCommentsNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'comments');

const getLogNodeId = (ticketId: string) => virtualNodeId(ticketId, 'history');

const getDiffNodeId = (ticketId: string) => virtualNodeId(ticketId, 'diff');

const getAttachmentsNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'attachments');

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

	const diffNodeId = useMemo(() => getDiffNodeId(ticket.id), [ticket.id]);

	const attachmentsNodeId = useMemo(
		() => getAttachmentsNodeId(ticket.id),
		[ticket.id],
	);

	const attachmentCount = nodeRepo.getAttachmentsByIssue(ticket.id).length;

	const isAtTicketRoot = contextNode.id === ticket.id;

	const isInsideComments =
		contextNode.id === commentsNodeId ||
		contextNode.parentNodeId === commentsNodeId;

	const isInsideLog =
		contextNode.id === logNodeId || contextNode.parentNodeId === logNodeId;

	const isInsideAttachments =
		contextNode.id === attachmentsNodeId ||
		contextNode.parentNodeId === attachmentsNodeId;

	const isInsideDiff =
		contextNode.id === diffNodeId || contextNode.parentNodeId === diffNodeId;

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

	if (isInsideAttachments) {
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
				<AttachmentListUI
					ticket={ticket}
					width={maxWidth}
					height={editorHeight}
				/>
			</Box>
		);
	}

	if (isInsideDiff) {
		const commandPromptHeight = 3;
		const listHeight = height - commandPromptHeight;

		return (
			<Box
				width={maxWidth}
				flexDirection="column"
				paddingRight={1}
				paddingBottom={1}
				minHeight={height}
			>
				<DiffListUI ticket={ticket} width={maxWidth} height={listHeight} />
			</Box>
		);
	}

	if (isInsideLog) {
		const logNode = nodeRepo.getNode(logNodeId);
		const logValue =
			logNode && isFieldNode(logNode) ? logNode.props.value ?? '' : '';

		const editorRows = inlineEditorRowCount(height);

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
						rows={editorRows}
					/>
				) : null}
			</Box>
		);
	}

	// The `››` rows, in the order they are drawn. Only the first of them carries
	// the blank line above: together they read as one menu, and spacing them
	// apart costs rows the description box needs.
	const menuNodeIds = [
		logNodeId,
		diffNodeId,
		commentsNodeId,
		attachmentsNodeId,
	];
	const isMenuNode = (id: string) => menuNodeIds.includes(id);

	const fieldCount = children.reduce(
		(count, child) => (isFieldListNode(child) ? count + 1 : count),
		0,
	);

	const menuCount = children.reduce(
		(count, child) => (isMenuNode(child.id) ? count + 1 : count),
		0,
	);

	const firstMenuIndex = children.findIndex(child => isMenuNode(child.id));

	const editorRows = inlineEditorRowCount(height, fieldCount, menuCount);

	const menuRow = (
		child: ReturnType<typeof getRenderedChildren>[number],
		index: number,
		selected: boolean,
		label: string,
	) => (
		<Box key={child.id} paddingTop={index === firstMenuIndex ? 1 : 0}>
			<CursorUI isSelected={selected} />
			<Text
				backgroundColor={theme.secondary}
				color={selected ? theme.accent : theme.primary}
			>
				{label}
			</Text>
		</Box>
	);

	const renderNode = (
		child: ReturnType<typeof getRenderedChildren>[number],
		selected: boolean,
		index: number,
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
					rows={editorRows}
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
			return menuRow(child, index, selected, ` Comments (${commentCount}) ›› `);
		}

		if (child.id === attachmentsNodeId) {
			return menuRow(
				child,
				index,
				selected,
				` Attachments (${attachmentCount}) ›› `,
			);
		}

		if (child.id === logNodeId) {
			return menuRow(child, index, selected, ' History ›› ');
		}

		// No count beside it, unlike Comments and Attachments: a ticket's commits
		// come from git, and this row is drawn during a synchronous render of
		// every ticket. The count is inside.
		if (child.id === diffNodeId) {
			return menuRow(child, index, selected, ' Diff ›› ');
		}

		return null;
	};

	return (
		// The right padding is counted in inline-editor-layout.ts
		<Box
			width={maxWidth}
			flexDirection="column"
			paddingRight={1}
			paddingBottom={1}
			minHeight={height}
		>
			{children.map((child, index) =>
				renderNode(child, isAtTicketRoot && selectedIndex === index, index),
			)}
		</Box>
	);
};
