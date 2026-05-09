import {isFieldListNode, isFieldNode} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';

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

	if (
		existing.title !== name ||
		existing.parentNodeId !== parentNodeId ||
		existing.rank !== rank ||
		existing.props.value !== value ||
		existing.readonly !== readonly ||
		existing.childRenderAxis !== childRenderAxis
	) {
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
	}
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

	if (
		existing.title !== name ||
		existing.parentNodeId !== parentNodeId ||
		existing.rank !== rank ||
		existing.readonly !== readonly ||
		existing.childRenderAxis !== childRenderAxis
	) {
		nodeRepo.updateNode({
			...existing,
			title: name,
			parentNodeId,
			rank,
			readonly,
			childRenderAxis,
		});
	}
};
