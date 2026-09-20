import {AppEvent} from '../board/board-events.model.js';
import {formatLogLine} from '../board/format-log-utils.js';
import {
	isFieldListNode,
	isFieldNode,
	isTicketNode,
	Ticket,
	TicketContext,
} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {FieldNames} from '../repository/fielNames.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {getState} from '../state/state.js';
import {bigIntToHex, MAX_RANK} from '../utils/rank.js';
import {virtualNodeId} from './virtual-ids.js';

const getCommentsNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'comments');

const getDescriptionNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'description');

const getAssigneesNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'assignees');

const getTagsNodeId = (ticketId: string) => virtualNodeId(ticketId, 'tags');

const getLogNodeId = (ticketId: string) => virtualNodeId(ticketId, 'history');

const getDiffNodeId = (ticketId: string) => virtualNodeId(ticketId, 'diff');

const getAttachmentsNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'attachments');

type VirtualNodeInput = {
	id: string;
	name: string;
	parentNodeId: string;
	rank: string;
	readonly?: boolean;
	childRenderAxis?: 'vertical' | 'horizontal';
};

export const createOrUpdateVirtualField = ({
	id,
	name,
	parentNodeId,
	rank,
	value,
	readonly = false,
	childRenderAxis = 'horizontal',
}: VirtualNodeInput & {
	value?: string;
}): Result<void> => {
	const existing = nodeRepo.getNode(id);

	if (!existing) {
		const result = nodeRepo.createNode({
			...nodes.field({
				id,
				name,
				parentNodeId,
				rank,
				props: {value},
				isVirtual: true,
			}),
			readonly,
			childRenderAxis,
		});

		if (isFail(result)) return result;

		return succeeded('Virtual field created', undefined);
	}

	if (!isFieldNode(existing)) {
		return failed(`Existing virtual node ${id} is not a field`);
	}

	const isDirty =
		existing.title !== name ||
		existing.parentNodeId !== parentNodeId ||
		existing.rank !== rank ||
		existing.props.value !== value ||
		existing.readonly !== readonly ||
		existing.childRenderAxis !== childRenderAxis;

	if (!isDirty) return succeeded('Virtual field unchanged', undefined);

	const result = nodeRepo.updateNode({
		...existing,
		title: name,
		parentNodeId,
		rank,
		props: {
			...existing.props,
			value,
		},
		readonly,
		childRenderAxis,
	});

	if (isFail(result)) return result;

	return succeeded('Virtual field updated', undefined);
};

export const createOrUpdateVirtualFieldList = ({
	id,
	name,
	parentNodeId,
	rank,
	readonly = false,
	childRenderAxis = 'horizontal',
}: VirtualNodeInput): Result<void> => {
	const existing = nodeRepo.getNode(id);

	if (!existing) {
		const result = nodeRepo.createNode({
			...nodes.fieldList({
				id,
				name,
				parentNodeId,
				rank,
				isVirtual: true,
			}),
			readonly,
			childRenderAxis,
		});

		if (isFail(result)) return result;

		return succeeded('Virtual field list created', undefined);
	}

	if (!isFieldListNode(existing)) {
		return failed(`Existing virtual node ${id} is not a field list`);
	}

	const isDirty =
		existing.title !== name ||
		existing.parentNodeId !== parentNodeId ||
		existing.rank !== rank ||
		existing.readonly !== readonly ||
		existing.childRenderAxis !== childRenderAxis;

	if (!isDirty) return succeeded('Virtual field list unchanged', undefined);

	const result = nodeRepo.updateNode({
		...existing,
		title: name,
		parentNodeId,
		rank,
		readonly,
		childRenderAxis,
	});

	if (isFail(result)) return result;

	return succeeded('Virtual field list updated', undefined);
};

// Where a ticket's seven rows sit relative to each other. The same seven
// strings for every ticket on every board, so they are derived once rather
// than per ticket — seven BigInt divisions and hex conversions per refresh
// came to 11.9 ms per three thousand tickets for an answer that never changes.
//
// Lazily, because `bigIntToHex` returns a Result and a module body has nowhere
// to report a failure to; the fractions are constant, so the first call
// settles it for the process.
type VirtualFieldRanks = {
	description: string;
	assignees: string;
	tags: string;
	comments: string;
	attachments: string;
	log: string;
	diff: string;
};

let virtualFieldRanks: VirtualFieldRanks | null = null;

const getVirtualFieldRanks = (): Result<VirtualFieldRanks> => {
	if (virtualFieldRanks) {
		return succeeded('Virtual field ranks', virtualFieldRanks);
	}

	const descriptionRank = bigIntToHex(MAX_RANK / 4n);
	const assigneesRank = bigIntToHex(MAX_RANK / 2n);
	const tagsRank = bigIntToHex((MAX_RANK * 3n) / 4n);
	const commentsRank = bigIntToHex((MAX_RANK * 7n) / 8n);
	const attachmentsRank = bigIntToHex((MAX_RANK * 15n) / 16n);
	const logRank = bigIntToHex((MAX_RANK * 13n) / 16n);
	const diffRank = bigIntToHex((MAX_RANK * 27n) / 32n);

	if (isFail(descriptionRank)) return descriptionRank;
	if (isFail(assigneesRank)) return assigneesRank;
	if (isFail(tagsRank)) return tagsRank;
	if (isFail(commentsRank)) return commentsRank;
	if (isFail(attachmentsRank)) return attachmentsRank;
	if (isFail(logRank)) return logRank;
	if (isFail(diffRank)) return diffRank;

	virtualFieldRanks = {
		description: descriptionRank.value,
		assignees: assigneesRank.value,
		tags: tagsRank.value,
		comments: commentsRank.value,
		attachments: attachmentsRank.value,
		log: logRank.value,
		diff: diffRank.value,
	};

	return succeeded('Virtual field ranks', virtualFieldRanks);
};

export const materializeTicketVirtualNodes = (
	node: NavNode<TicketContext>,
): Result<void> => {
	const ranksResult = getVirtualFieldRanks();
	if (isFail(ranksResult)) return ranksResult;

	const ranks = ranksResult.value;

	const descriptionResult = createOrUpdateVirtualField({
		id: getDescriptionNodeId(node.id),
		name: FieldNames.DESCRIPTION,
		parentNodeId: node.id,
		rank: ranks.description,
		value: node.props.description ?? '',
		childRenderAxis: 'vertical',
	});
	if (isFail(descriptionResult)) return descriptionResult;

	const assigneesResult = createOrUpdateVirtualFieldList({
		id: getAssigneesNodeId(node.id),
		name: FieldNames.ASSIGNEES,
		parentNodeId: node.id,
		rank: ranks.assignees,
		readonly: true,
	});
	if (isFail(assigneesResult)) return assigneesResult;

	const tagsResult = createOrUpdateVirtualFieldList({
		id: getTagsNodeId(node.id),
		name: FieldNames.TAGS,
		parentNodeId: node.id,
		rank: ranks.tags,
		readonly: true,
	});
	if (isFail(tagsResult)) return tagsResult;

	const commentsResult = createOrUpdateVirtualField({
		id: getCommentsNodeId(node.id),
		name: FieldNames.COMMENTS,
		parentNodeId: node.id,
		rank: ranks.comments,
		value: '',
		readonly: false,
		childRenderAxis: 'vertical',
	});
	if (isFail(commentsResult)) return commentsResult;

	const attachmentsResult = createOrUpdateVirtualField({
		id: getAttachmentsNodeId(node.id),
		name: FieldNames.ATTACHMENTS,
		parentNodeId: node.id,
		rank: ranks.attachments,
		value: '',
		readonly: true,
		childRenderAxis: 'vertical',
	});
	if (isFail(attachmentsResult)) return attachmentsResult;

	const logResult = createOrUpdateVirtualField({
		id: getLogNodeId(node.id),
		name: FieldNames.HISTORY,
		parentNodeId: node.id,
		rank: ranks.log,
		value: getLog(node),
		readonly: true,
		childRenderAxis: 'vertical',
	});
	if (isFail(logResult)) return logResult;

	// Empty, unlike History, which carries its whole rendered log as the node's
	// value. A ticket's commits come from git, and this runs synchronously for
	// every ticket on every replay — so the row is a marker to navigate into,
	// and the commits are read when somebody does.
	const diffResult = createOrUpdateVirtualField({
		id: getDiffNodeId(node.id),
		name: FieldNames.DIFF,
		parentNodeId: node.id,
		rank: ranks.diff,
		value: '',
		readonly: true,
		childRenderAxis: 'vertical',
	});
	if (isFail(diffResult)) return diffResult;

	return succeeded('Ticket virtual nodes materialized', undefined);
};

export type LogActionEvolution = Map<AppEvent['action'], AppEvent['payload'][]>;
export type LogEvolutionForEvent<A extends AppEvent['action']> = Extract<
	AppEvent,
	{action: A}
>['payload'][];

const getLog = (node: Ticket) => {
	const orderedLog = [...node.log].reverse();
	const logActionEvolution: LogActionEvolution = new Map();

	for (const event of orderedLog) {
		const evolution = logActionEvolution.get(event.action) ?? [];
		evolution.push(event.payload);
		logActionEvolution.set(event.action, evolution);
	}

	return orderedLog
		.map(event =>
			formatLogLine(event, logActionEvolution.get(event.action) ?? []),
		)
		.join('\n');
};

// A ticket's virtual fields exist for the TUI to navigate into; nothing in the
// GUI or MCP reads them. Building them is most of a replay, so those processes
// turn them off. Defaults on, so a caller that never opts out is unaffected.
let virtualNodesEnabled = true;

export const setVirtualNodesEnabled = (enabled: boolean): void => {
	virtualNodesEnabled = enabled;
};

export const areVirtualNodesEnabled = (): boolean => virtualNodesEnabled;

export const materializeVirtualNodes = (): Result<void> => {
	const {nodes} = getState();

	for (const node of Object.values(nodes)) {
		if (!isTicketNode(node)) continue;

		const result = materializeTicketVirtualNodes(node);
		if (isFail(result)) return result;
	}

	return succeeded('Virtual nodes materialized', undefined);
};
