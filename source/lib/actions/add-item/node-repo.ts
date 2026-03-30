import {
	failed,
	ReturnFail,
	ReturnSuccess,
	succeeded,
} from '../../command-line/command-types.js';
import {Contributor, Tag} from '../../model/app-state.model.js';
import {AnyContext} from '../../model/context.model.js';
import {NavNode} from '../../model/navigation-node.model.js';
import {getState, patchState, updateState} from '../../state/state.js';

export const appendChildId = <T extends AnyContext>(
	parent: NavNode<T>,
	childId: string,
): NavNode<T> => ({
	...parent,
	children: [...parent.children, childId],
});

export const findAncestor = <T extends AnyContext>(
	targetId: string,
	ctx: T,
): ReturnSuccess<NavNode<T>> | ReturnFail => {
	const {nodes} = getState();

	const start = nodes[targetId];
	if (!start) return failed('Node not found');

	if (start.context === ctx) {
		return succeeded('Resolved ancestor node', start as NavNode<T>);
	}

	let current = start.parentNodeId ? nodes[start.parentNodeId] : undefined;

	while (current) {
		if (current.context === ctx) {
			return succeeded('Resolved ancestor node', current as NavNode<T>);
		}
		current = current.parentNodeId ? nodes[current.parentNodeId] : undefined;
	}

	return failed(`No ancestor found for context: ${ctx}`);
};

const asStringArray = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((x): x is string => typeof x === 'string')
		: [];

export const nodeRepo = {
	tombstoneNode(parentId: string, nodeId: string): ReturnSuccess | ReturnFail {
		const {nodes, currentNodeId, rootNodeId} = getState();

		const parent = this.getNode(parentId);
		const node = this.getNode(nodeId);

		if (!parent) return failed('Parent node not found');
		if (!node) return failed('Node not found');
		if (rootNodeId === nodeId) return failed('Cannot delete root node');

		const idsToDelete = new Set<string>();

		const collectDescendants = (id: string) => {
			const current = nodes[id];
			if (!current || idsToDelete.has(id)) return;

			idsToDelete.add(id);
			for (const childId of current.children) {
				collectDescendants(childId);
			}
		};

		collectDescendants(nodeId);

		const nextNodes = {...structuredClone(nodes)};

		for (const id of idsToDelete) {
			if (!nextNodes[id]) return failed('Unable to locate node to delete');
			nextNodes[id] = {...nextNodes[id], isDeleted: 'deleted'};
		}

		const nextParent = {
			...parent,
			children: parent.children.filter(id => id !== nodeId),
		};

		nextNodes[parentId] = nextParent;

		if (!currentNodeId) {
			return failed('Unable to delete undefined');
		}

		const nextCurrentNodeId = idsToDelete.has(currentNodeId)
			? parentId
			: currentNodeId;

		patchState({
			nodes: nextNodes,
			currentNodeId: nextCurrentNodeId,
		});

		return succeeded('Successfully tombstoned', node);
	},

	createContributor(contributor: Contributor) {
		updateState(s => ({
			...s,
			contributors: {
				...s.contributors,
				[contributor.id]: contributor,
			},
		}));
		return contributor;
	},

	assign(targetId: string, contributorId: string) {
		const contributor = nodeRepo.getContributor(contributorId);
		const target = nodeRepo.getNode(targetId);
		if (!target || !contributor) {
			return failed('Unable assign contributor to issue');
		}

		const assigneesField = target.children
			.map(nodeRepo.getNode)
			.find(x => x?.title === 'Assignees');

		if (!assigneesField) return failed('Unable to locate assignees field');

		const currentValue = asStringArray(assigneesField.props.value);
		const nextValue = currentValue.includes(contributorId)
			? currentValue
			: [...currentValue, contributorId];

		nodeRepo.updateNode({
			...assigneesField,
			props: {
				...assigneesField.props,
				value: nextValue,
			},
		});

		return contributor;
	},

	createTag(tag: Tag) {
		updateState(s => ({
			...s,
			tags: {
				...s.tags,
				[tag.id]: tag,
			},
		}));
		return tag;
	},

	tag(targetId: string, tagId: string) {
		logger.debug(1, tagId, getState().nodes, getState().tags);
		const tag = nodeRepo.getTag(tagId);
		const target = nodeRepo.getNode(targetId);
		if (!tag) return failed('Unable to add tag, missing tag');
		if (!target) return failed('Unable to add tag, missing target');
		logger.debug(2);

		const tagsField = target.children
			.map(nodeRepo.getNode)
			.find(x => x?.title === 'Tags');
		logger.debug(3);

		if (!tagsField) return failed('Unable to locate tags field');
		logger.debug(4);

		const currentValue = asStringArray(tagsField.props.value);
		logger.debug(5);
		const nextValue = currentValue.includes(tagId)
			? currentValue
			: [...currentValue, tagId];

		logger.debug(6);
		nodeRepo.updateNode({
			...tagsField,
			props: {
				...tagsField.props,
				value: nextValue,
			},
		});

		logger.debug(7);
		logger.debug('here', getState().nodes);
		return succeeded('Tag added', tag);
	},

	createNode<T extends AnyContext>(node: NavNode<T>) {
		updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[node.id]: node,
			},
		}));

		if (node.parentNodeId) this.appendChildToNode(node.parentNodeId, node);

		return node as NavNode<T>;
	},

	createNodes(nodes: NavNode<AnyContext>[]) {
		updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				...Object.fromEntries(nodes.map(node => [node.id, node])),
			},
		}));

		return nodes;
	},

	updateNode(node: NavNode<AnyContext>) {
		updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[node.id]: node,
			},
			currentNodeId: s.currentNodeId,
		}));

		return node;
	},

	appendChildToNode(parentId: string, child: NavNode<AnyContext>) {
		const {nodes} = getState();
		const parent = this.getNode(parentId);
		if (!parent) {
			logger.error(
				'Unable to add child node to undefined parent with id:',
				parentId,
			);
			return;
		}
		const nextParent = appendChildId(parent, child.id);

		patchState({
			nodes: {
				...nodes,
				[parentId]: nextParent,
				[child.id]: child,
			},
		});

		return child;
	},

	getContributor(id: string): Contributor | undefined {
		return getState().contributors[id];
	},

	getTag(id: string): Tag | undefined {
		return getState().tags[id];
	},

	getNode<T extends AnyContext>(id: string) {
		return getState().nodes[id] as NavNode<T> | undefined;
	},
};
