import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useRef} from 'react';
import {decodeTime} from 'ulid';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {timeAgo} from '../event/date-utils.js';
import {isFieldNode, Ticket} from '../model/context.model.js';
import {AttachmentState} from '../model/app-state.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {isSuccess} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {getState, useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {virtualNodeId} from '../virtual-nodes/virtual-ids.js';
import {ScrollBoxUI} from './ScrollBox.js';

type Props = {
	ticket: Ticket;
	width: number;
	height: number;
};

const getAttachmentsRootNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'attachments');

const getAttachmentItems = (ticket: Ticket): AttachmentState[] =>
	nodeRepo
		.getAttachmentsByIssue(ticket.id)
		.sort((a, b) => decodeTime(a.id) - decodeTime(b.id));

const detachAttachmentNodes = (attachmentNodes: NavNode<'FIELD'>[]) => {
	for (const node of attachmentNodes) {
		nodeRepo.deleteNode(node.id);
	}
};

const createAttachmentNode = (
	attachment: AttachmentState,
	index: number,
	parentNodeId: string,
): NavNode<'FIELD'> =>
	nodes.field({
		id: attachment.id,
		name: attachment.name,
		parentNodeId,
		rank: String(index).padStart(6, '0'),
		isVirtual: true,
	});

const attachAttachmentNodes = (
	ticket: Ticket,
	attachments: AttachmentState[],
): NavNode<'FIELD'>[] => {
	const rootNode = nodeRepo.getNode(getAttachmentsRootNodeId(ticket.id));
	if (!rootNode || !isFieldNode(rootNode)) return [];

	const created = attachments
		.map((attachment, index) =>
			createAttachmentNode(attachment, index, rootNode.id),
		)
		.map(node => nodeRepo.createNode(node))
		.filter(isSuccess)
		.map(({value}) => value)
		.filter(isFieldNode);

	if (attachments.length > 0 && getState().selectedIndex < 0) {
		navigationUtils.navigate({
			contextNode: rootNode,
			selectedIndex: 0,
		});
	}

	return created;
};

const formatKb = (bytes: number) =>
	`${Math.max(1, Math.round(bytes / 1024))} KB`;

export function AttachmentListUI({ticket, width, height}: Props) {
	const attachments = useMemo(() => getAttachmentItems(ticket), [ticket]);

	const attachmentNodesRef = useRef<NavNode<'FIELD'>[]>([]);

	useEffect(() => {
		detachAttachmentNodes(attachmentNodesRef.current);

		attachmentNodesRef.current = attachAttachmentNodes(ticket, attachments);

		return () => {
			detachAttachmentNodes(attachmentNodesRef.current);
			attachmentNodesRef.current = [];
		};
	}, [ticket, attachments]);

	const {selectedIndex} = useAppState();
	const padding = 4;
	const scrollHeight = Math.max(1, height - padding);
	const nameWidth = Math.max(12, width - 32);

	if (attachments.length === 0) {
		return (
			<Box flexDirection="column" width={width} height={height} padding={1}>
				<Text color={theme.primary}>No attachments yet.</Text>
				<Box paddingTop={1}>
					<Text color={theme.primary}>Attach images from the browser GUI</Text>
					<Text color={theme.accent}> epiq gui </Text>
					<Text color={theme.primary}>by dropping or pasting them.</Text>
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
				<Text color={theme.secondary2}>
					Attachments ({attachments.length}) — enter to open{' '}
				</Text>
			</Box>

			<ScrollBoxUI
				height={scrollHeight}
				itemHeight={2}
				selectedIndex={selectedIndex}
			>
				{attachments.map((attachment, index) => {
					const isSelected = index === selectedIndex;
					const name =
						attachment.name.length > nameWidth
							? attachment.name.slice(0, nameWidth - 1) + '…'
							: attachment.name;

					return (
						<Box
							key={attachment.id}
							flexDirection="row"
							paddingX={1}
							paddingBottom={1}
						>
							<Text color={theme.accent}>{isSelected ? '❯ ' : '  '}</Text>
							<Box paddingLeft={1}>
								<Text color={theme.secondary2}>{`#${index + 1} `}</Text>
								<Text color={isSelected ? theme.accent : theme.primary}>
									{name}
								</Text>
								<Text color={theme.secondary2}>
									{'  ' +
										formatKb(attachment.bytes) +
										'  ' +
										timeAgo(decodeTime(attachment.id))}
								</Text>
							</Box>
						</Box>
					);
				})}
			</ScrollBoxUI>
		</Box>
	);
}
