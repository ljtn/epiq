import {AppEvent} from '../event/event.model.js';
import {formatLogLine} from '../event/format-log-utils.js';
import {
	isFieldListNode,
	isFieldNode,
	isTicketNode,
	Ticket,
	TicketContext,
} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {isFail} from '../model/result-types.js';
import {FieldNames} from '../repository/fielNames.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {getState} from '../state/state.js';
import {bigIntToHex, MAX_RANK} from '../utils/rank.js';
import {virtualNodeId} from './virtual-ids.js';

const getDescriptionNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'description');

const getAssigneesNodeId = (ticketId: string) =>
	virtualNodeId(ticketId, 'assignees');

const getTagsNodeId = (ticketId: string) => virtualNodeId(ticketId, 'tags');

const getLogNodeId = (ticketId: string) => virtualNodeId(ticketId, 'history');

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
}) => {
	const existing = nodeRepo.getNode(id);

	if (!existing) {
		nodeRepo.createNode({
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

		return;
	}

	if (!isFieldNode(existing)) return;

	const isDirty =
		existing.title !== name ||
		existing.parentNodeId !== parentNodeId ||
		existing.rank !== rank ||
		existing.props.value !== value ||
		existing.readonly !== readonly ||
		existing.childRenderAxis !== childRenderAxis;
	if (!isDirty) return;

	nodeRepo.updateNode({
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
};

export const createOrUpdateVirtualFieldList = ({
	id,
	name,
	parentNodeId,
	rank,
	readonly = false,
	childRenderAxis = 'horizontal',
}: VirtualNodeInput) => {
	const existing = nodeRepo.getNode(id);

	if (!existing) {
		nodeRepo.createNode({
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

		return;
	}

	if (!isFieldListNode(existing)) return;

	const isDirty =
		existing.title !== name ||
		existing.parentNodeId !== parentNodeId ||
		existing.rank !== rank ||
		existing.readonly !== readonly ||
		existing.childRenderAxis !== childRenderAxis;
	if (!isDirty) return;

	nodeRepo.updateNode({
		...existing,
		title: name,
		parentNodeId,
		rank,
		readonly,
		childRenderAxis,
	});
};

export const materializeTicketVirtualNodes = (node: NavNode<TicketContext>) => {
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
		id: getDescriptionNodeId(node.id),
		name: FieldNames.DESCRIPTION,
		parentNodeId: node.id,
		rank: descriptionRank.value,
		value: node.props.description ?? '',
		childRenderAxis: 'vertical',
	});

	createOrUpdateVirtualFieldList({
		id: getAssigneesNodeId(node.id),
		name: FieldNames.ASSIGNEES,
		parentNodeId: node.id,
		rank: assigneesRank.value,
		readonly: true,
	});

	createOrUpdateVirtualFieldList({
		id: getTagsNodeId(node.id),
		name: FieldNames.TAGS,
		parentNodeId: node.id,
		rank: tagsRank.value,
		readonly: true,
	});

	createOrUpdateVirtualField({
		id: getLogNodeId(node.id),
		name: FieldNames.HISTORY,
		parentNodeId: node.id,
		rank: logRank.value,
		value: getLog(node),
		readonly: true,
		childRenderAxis: 'vertical',
	});
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

export const materializeVirtualNodes = () => {
	const {nodes} = getState();

	for (const node of Object.values(nodes)) {
		if (isTicketNode(node)) materializeTicketVirtualNodes(node);
	}
};
