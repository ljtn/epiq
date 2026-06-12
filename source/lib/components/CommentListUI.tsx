import {Box, Text} from 'ink';
import React, {useEffect, useMemo} from 'react';
import {decodeTime} from 'ulid';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {timeAgo} from '../event/date-utils.js';
import {AppEvent} from '../event/event.model.js';
import {isFieldNode, isTextNode, Ticket} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {isSuccess} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {virtualNodeId} from '../virtual-nodes/virtual-ids.js';
import {AssigneeUI} from './Assignee.js';
import {ScrollBoxUI} from './ScrollBox.js';

type Props = {
	ticket: Ticket;
	width: number;
	height: number;
};

type CommentItem = {
	id: string;
	issue: string;
	author: string;
	md: string;
	eventId: string;
	userId: string;
	userName: string;
};

const getCommentsRootNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'comments');

const toCommentNodeId = (commentId: string) => `comment:${commentId}`;

const isAddCommentEvent = (
	event: AppEvent,
): event is AppEvent<'add.issue.comment'> =>
	event.action === 'add.issue.comment';

const isDeleteCommentEvent = (
	event: AppEvent,
): event is AppEvent<'delete.issue.comment'> =>
	event.action === 'delete.issue.comment';

const getCommentItems = (ticket: Ticket): CommentItem[] => {
	const log = ticket.log ?? [];

	const deletedCommentIds = new Set(
		log.filter(isDeleteCommentEvent).map(event => event.payload.comment),
	);

	return log
		.filter(isAddCommentEvent)
		.filter(event => event.payload.issue === ticket.id)
		.filter(event => !deletedCommentIds.has(event.payload.id))
		.reverse()
		.map(event => ({
			id: event.payload.id,
			issue: event.payload.issue,
			author: event.payload.author,
			md: event.payload.md,
			eventId: event.id,
			userId: event.userId,
			userName: event.userName,
		}));
};

const createCommentNode = (
	comment: CommentItem,
	index: number,
	parentNodeId: string,
): NavNode<'TEXT'> =>
	nodes.text({
		id: toCommentNodeId(comment.id),
		parentNodeId,
		rank: String(index).padStart(6, '0'),
		name: comment.id,
		props: {
			value: comment.md,
		},
		readonly: true,
		isVirtual: true,
	});

let commentNodes: NavNode<'TEXT'>[] = [];

const detachCommentNodes = () => {
	const ids = commentNodes.map(node => node.id);
	commentNodes = [];

	for (const id of ids) nodeRepo.deleteNode(id);
};

const attachCommentNodes = (ticket: Ticket, comments: CommentItem[]) => {
	detachCommentNodes();

	const rootNode = nodeRepo.getNode(getCommentsRootNodeId(ticket.id));
	if (!rootNode || !isFieldNode(rootNode)) return;

	commentNodes = comments
		.map((comment, index) => createCommentNode(comment, index, rootNode.id))
		.map(nodeRepo.createNode)
		.filter(isSuccess)
		.map(({value}) => value)
		.filter(isTextNode);

	if (comments.length > 0 && getState().selectedIndex < 0) {
		navigationUtils.navigate({
			contextNode: rootNode,
			selectedIndex: 0,
		});
	}
};

const renderCommentBody = (md: string, maxLength: number) => {
	const normalized = md.replace(/\s+/g, ' ').trim();

	if (normalized.length <= maxLength) return normalized;

	return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
};

export function CommentListUI({ticket, width, height}: Props) {
	const comments = useMemo(() => getCommentItems(ticket), [ticket]);

	useEffect(() => {
		attachCommentNodes(ticket, comments);

		return () => {
			detachCommentNodes();
		};
	}, [ticket, comments]);

	const selectedIndex = getState().selectedIndex;
	const scrollHeight = Math.max(1, height - 2);
	const bodyWidth = Math.max(20, width - 8);

	if (comments.length === 0) {
		return (
			<Box flexDirection="column" width={width} height={height} padding={1}>
				<Text color={theme.accent}>No comments yet.</Text>
				<Text color={theme.secondary2} dimColor>
					Use :comment to add the first one.
				</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Text color={theme.secondary2}>
				Comments ({comments.length}) · :comment to add
			</Text>

			<ScrollBoxUI
				height={scrollHeight}
				itemHeight={4}
				selectedIndex={selectedIndex}
			>
				{comments.map((comment, index) => {
					const isSelected = index === selectedIndex;

					return (
						<Box
							key={comment.id}
							flexDirection="column"
							paddingX={1}
							borderLeft={false}
							borderBottom={false}
							borderRight={false}
							borderColor={theme.secondary}
							borderStyle="single"
						>
							<Box flexDirection="row">
								<Text color={theme.accent}>{isSelected ? '❯ ' : '  '}</Text>
								<AssigneeUI id={comment.author} />
								<Text color={theme.secondary2}>
									{' ' + timeAgo(decodeTime(comment.id))}
								</Text>
							</Box>

							<Box paddingLeft={2} paddingBottom={1}>
								<Text color={theme.primary}>
									{' ' + renderCommentBody(comment.md, bodyWidth)}
								</Text>
							</Box>
						</Box>
					);
				})}
			</ScrollBoxUI>
		</Box>
	);
}
