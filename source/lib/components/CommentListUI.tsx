import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useRef} from 'react';
import {decodeTime} from 'ulid';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {timeAgo} from '../utils/date.utils.js';
import {
	Comment,
	isCommentNode,
	isFieldNode,
	Ticket,
} from '../model/context.model.js';
import {isSuccess} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getState, useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {virtualNodeId} from '../virtual-nodes/virtual-ids.js';
import {AssigneeUI} from './Assignee.js';
import {ScrollBoxUI} from './ScrollBox.js';
import {CommentItem, createCommentNode} from '../utils/comment.utils.js';

type Props = {
	ticket: Ticket;
	width: number;
	height: number;
};

const getCommentsRootNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'comments');

const getCommentItems = (ticket: Ticket): CommentItem[] =>
	nodeRepo
		.getCommentsByIssue(ticket.id)
		.sort((a, b) => decodeTime(a.id) - decodeTime(b.id))
		.map(comment => ({
			id: comment.id,
			issue: comment.issue,
			authorId: comment.authorId,
			authorName: comment.authorName,
			md: comment.md,
		}));

const detachCommentNodes = (commentNodes: Comment[]) => {
	for (const node of commentNodes) {
		nodeRepo.deleteNode(node.id);
	}
};

const attachCommentNodes = (
	ticket: Ticket,
	comments: CommentItem[],
): Comment[] => {
	const rootNode = nodeRepo.getNode(getCommentsRootNodeId(ticket.id));
	if (!rootNode || !isFieldNode(rootNode)) return [];

	const nodes = comments
		.map((comment, index) => createCommentNode(comment, index, rootNode.id))
		.map(nodeRepo.createNode)
		.filter(isSuccess)
		.map(({value}) => value)
		.filter(isCommentNode);

	if (comments.length > 0 && getState().selectedIndex < 0) {
		navigationUtils.navigate({
			contextNode: rootNode,
			selectedIndex: 0,
		});
	}

	return nodes;
};

const renderCommentBody = (md: string, maxLength: number) => {
	const normalized = md.replace(/\s+/g, ' ').trim();

	if (normalized.length <= maxLength) return normalized;

	return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
};

export function CommentListUI({ticket, width, height}: Props) {
	const comments = useMemo(() => getCommentItems(ticket), [ticket]);

	const commentNodesRef = useRef<Comment[]>([]);

	useEffect(() => {
		detachCommentNodes(commentNodesRef.current);

		commentNodesRef.current = attachCommentNodes(ticket, comments);

		return () => {
			detachCommentNodes(commentNodesRef.current);
			commentNodesRef.current = [];
		};
	}, [ticket, comments]);

	const {selectedIndex} = useAppState();
	const padding = 4;
	const scrollHeight = Math.max(1, height - padding);
	const bodyWidth = Math.max(20, width - 8);

	if (comments.length === 0) {
		return (
			<Box flexDirection="column" width={width} height={height} padding={1}>
				<Text color={theme.primary}>No comments yet.</Text>
				<Box paddingTop={1}>
					<Text color={theme.primary}>Use</Text>
					<Text color={theme.accent}> :comment </Text>
					<Text color={theme.primary}>to add the first one.</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" width={width} height={height}>
			<Box
				paddingLeft={4}
				borderLeft={false}
				borderRight={false}
				borderBottom={false}
				borderTop={true}
				borderColor={theme.secondary}
				borderStyle="single"
				paddingBottom={1}
			>
				<Text color={theme.secondary2}>Comments ({comments.length}) </Text>
			</Box>

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
							<Box flexDirection="row" paddingBottom={1}>
								<Text color={theme.accent}>{isSelected ? '❯ ' : '  '}</Text>
								<Box paddingLeft={1}>
									<Text color={theme.secondary2}>{`#${index + 1} `}</Text>
									<AssigneeUI id={comment.authorId} />
									<Text color={theme.secondary2}>
										{' ' + timeAgo(decodeTime(comment.id))}
									</Text>
								</Box>
							</Box>

							<Box paddingLeft={3} paddingBottom={1}>
								<Text color={theme.primary}>
									{renderCommentBody(comment.md, bodyWidth)}
								</Text>
							</Box>
						</Box>
					);
				})}
			</ScrollBoxUI>
		</Box>
	);
}
