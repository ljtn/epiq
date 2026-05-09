import {Box, Text} from 'ink';
import React, {useEffect, useMemo} from 'react';
import {navigationUtils} from '../actions/default/navigation-action-utils.js';
import {formatLogLine} from '../event/format-log-utils.js';
import {isFail} from '../model/result-types.js';
import {isFieldListNode, isFieldNode, Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {FieldNames} from '../repository/fielNames.js';
import {getRenderedChildren, useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {bigIntToHex, MAX_RANK} from '../utils/rank.js';
import {
	createOrUpdateVirtualField,
	createOrUpdateVirtualFieldList,
} from '../virtual-nodes/virtual-nodes.js';
import {CursorUI} from './Cursor.js';
import {FieldListUI} from './FieldListUI.js';
import {InlineEditor} from './InlineEditor.js';

type Props = {
	ticket: Ticket;
	height: number;
};

const getDescriptionNodeId = (ticketId: string) => `${ticketId}::description`;
const getAssigneesNodeId = (ticketId: string) => `${ticketId}::assignees`;
const getTagsNodeId = (ticketId: string) => `${ticketId}::tags`;
const getLogNodeId = (ticketId: string) => `${ticketId}::log`;

export const TicketUI: React.FC<Props> = ({ticket, height}) => {
	const {selectedIndex, currentNode} = useAppState();
	const maxWidth = process.stdout.columns || 120;

	const descriptionNodeId = useMemo(
		() => getDescriptionNodeId(ticket.id),
		[ticket.id],
	);
	const assigneesNodeId = useMemo(
		() => getAssigneesNodeId(ticket.id),
		[ticket.id],
	);
	const tagsNodeId = useMemo(() => getTagsNodeId(ticket.id), [ticket.id]);
	const logNodeId = useMemo(() => getLogNodeId(ticket.id), [ticket.id]);

	const logText = useMemo(
		() => [...ticket.log].reverse().map(formatLogLine).join('\n'),
		[ticket.log],
	);

	useEffect(() => {
		const descriptionRank = bigIntToHex(MAX_RANK / 4n);
		const assigneesRank = bigIntToHex(MAX_RANK / 2n);
		const tagsRank = bigIntToHex((MAX_RANK * 3n) / 4n);
		const logRank = bigIntToHex(MAX_RANK);

		if (
			isFail(descriptionRank) ||
			isFail(assigneesRank) ||
			isFail(tagsRank) ||
			isFail(logRank)
		) {
			return;
		}

		createOrUpdateVirtualField({
			id: descriptionNodeId,
			name: FieldNames.DESCRIPTION,
			parentNodeId: ticket.id,
			rank: descriptionRank.value,
			value: ticket.props.description ?? '',
			childRenderAxis: 'vertical',
		});

		createOrUpdateVirtualFieldList({
			id: assigneesNodeId,
			name: FieldNames.ASSIGNEES,
			parentNodeId: ticket.id,
			rank: assigneesRank.value,
			readonly: true,
		});

		createOrUpdateVirtualFieldList({
			id: tagsNodeId,
			name: FieldNames.TAGS,
			parentNodeId: ticket.id,
			rank: tagsRank.value,
			readonly: true,
		});

		createOrUpdateVirtualField({
			id: logNodeId,
			name: FieldNames.HISTORY,
			parentNodeId: ticket.id,
			rank: logRank.value,
			value: logText,
			readonly: true,
			childRenderAxis: 'vertical',
		});

		return () => {
			nodeRepo.deleteNode(descriptionNodeId);
			nodeRepo.deleteNode(assigneesNodeId);
			nodeRepo.deleteNode(tagsNodeId);
			nodeRepo.deleteNode(logNodeId);
		};
	}, [
		ticket.id,
		ticket.props.description,
		ticket.props.assignees,
		ticket.props.tags,
		logText,
		descriptionNodeId,
		assigneesNodeId,
		tagsNodeId,
		logNodeId,
	]);

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
			isFieldListNode(child) || child.id === logNodeId ? count + 1 : count,
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
		if (child.id === descriptionNodeId) {
			return (
				<InlineEditor
					label="Description (press e to edit)"
					key={child.id}
					id={ticket.id}
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
