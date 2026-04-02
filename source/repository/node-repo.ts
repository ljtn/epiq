import {
	failed,
	isFail,
	Result,
	ReturnFail,
	ReturnSuccess,
	succeeded,
} from '../lib/command-line/command-types.js';
import {Contributor, Tag} from '../lib/model/app-state.model.js';
import {AnyContext, isFieldListNode} from '../lib/model/context.model.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {getState, patchState, updateState} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';
import {sanitizeInlineText} from '../lib/utils/string.utils.js';
import {getOrderedChildren, MovePosition, resolveMoveRank} from './rank.js';

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

const isDescendantOf = (nodeId: string, ancestorId: string): boolean => {
	const {nodes} = getState();

	let current = nodes[nodeId];
	while (current?.parentNodeId) {
		if (current.parentNodeId === ancestorId) return true;
		current = nodes[current.parentNodeId];
	}

	return false;
};

function normalizeListValue(value: string): string {
	return sanitizeInlineText(value).replace(/\s+/g, ' ').trim();
}

function collectFieldListValues(
	node: NavNode<AnyContext> | undefined,
	fieldName: string,
): string[] {
	if (!node) return [];

	const values: string[] = [];
	const seen = new Set<string>();
	const {renderedChildrenIndex} = getState();
	const visit = (current: NavNode<AnyContext>) => {
		const children = renderedChildrenIndex[current.id];
		if (current.title === fieldName && isFieldListNode(current)) {
			for (const child of children ?? []) {
				if (!child) continue;
				const raw = String(child.props?.['value'] ?? child.title ?? '');
				const value = normalizeListValue(raw);
				const key = value.toLowerCase();

				if (value && !seen.has(key)) {
					seen.add(key);
					values.push(value);
				}
			}
		}

		for (const child of children ?? []) {
			visit(child);
		}
	};

	visit(node);
	return values.sort((a, b) => a.localeCompare(b));
}

export const nodeRepo = {
	/* Only to be used for TEMP nodes*/
	deleteNode(nodeId: string) {
		updateState(s => {
			const nextNodes = {...s.nodes};
			delete nextNodes[nodeId];
			return {
				...s,
				nodes: nextNodes,
			};
		});
	},

	editValue(targetId: string, markdown: string): Result<{markdown: string}> {
		const {nodes} = getState();
		const targetNode = nodes[targetId];
		if (!targetNode) return failed('Edit target node not found');

		const updatedNode = {
			...targetNode,
			props: {
				...targetNode.props,
				value: markdown,
			},
		};

		nodeRepo.updateNode(updatedNode);
		return succeeded('Issue description updated', {markdown});
	},

	getExistingTags(): string[] {
		const {rootNodeId, nodes} = getState();
		const rootNode = nodes[rootNodeId];
		if (!rootNode) return [];
		return collectFieldListValues(rootNode, 'Tags');
	},

	getExistingAssignees(): string[] {
		const {rootNodeId, nodes} = getState();
		const rootNode = nodes[rootNodeId];
		if (!rootNode) return [];
		return collectFieldListValues(rootNode, 'Assignees');
	},
	moveNode(
		nodeId: string,
		nextParentId: string,
		position: MovePosition = {type: 'end'},
	): Result<NavNode<AnyContext>> {
		const {rootNodeId} = getState();
		const node = this.getNode(nodeId);
		const nextParent = this.getNode(nextParentId);

		if (!node) return failed('Node not found');
		if (!nextParent) return failed('Target parent not found');
		if (rootNodeId === nodeId) return failed('Cannot move root node');
		if (nodeId === nextParentId) return failed('Cannot move node into itself');

		if (isDescendantOf(nextParentId, nodeId)) {
			return failed('Cannot move node into its own descendant');
		}

		const siblings = getOrderedChildren(nextParentId).filter(
			x => x.id !== nodeId,
		);

		const rankResult = resolveMoveRank(siblings, position);
		if (isFail(rankResult)) return rankResult;

		const movedNode = {
			...node,
			parentNodeId: nextParentId,
			rank: rankResult.data,
		};

		this.updateNodeAndSelectInParent(movedNode);

		return succeeded('Moved node successfully', movedNode);
	},

	tombstoneNode(nodeId: string): ReturnSuccess | ReturnFail {
		const {nodes, currentNodeId, rootNodeId} = getState();

		const node = this.getNode(nodeId);
		if (!node) return failed('Node not found');

		if (rootNodeId === nodeId) return failed('Cannot delete root node');

		const idsToDelete = new Set<string>();

		const collectDescendants = (id: string) => {
			const current = nodes[id];
			if (!current || idsToDelete.has(id)) return;

			idsToDelete.add(id);

			for (const child of getOrderedChildren(current.id)) {
				collectDescendants(child.id);
			}
		};

		collectDescendants(nodeId);

		const nextNodes = {...structuredClone(nodes)};

		for (const id of idsToDelete) {
			if (!nextNodes[id]) return failed('Unable to locate node to delete');
			nextNodes[id] = {...nextNodes[id], isDeleted: true};
		}

		if (!currentNodeId) {
			return failed('Unable to delete undefined');
		}

		const nextCurrentNodeId = idsToDelete.has(currentNodeId)
			? node.parentNodeId
			: currentNodeId;

		patchState({
			nodes: nextNodes,
			currentNodeId: nextCurrentNodeId,
		});

		return succeeded('Successfully tomb stoned', node);
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

		const assigneesField = getOrderedChildren(target.id).find(
			x => x?.title === 'Assignees',
		);

		if (!assigneesField) return failed('Unable to locate assignees field');

		const currentValue =
			assigneesField.props.value?.split('|').map(s => s.trim()) ?? [];
		const nextValue = currentValue.includes(contributorId)
			? currentValue
			: [...currentValue, contributorId];

		nodeRepo.updateNode({
			...assigneesField,
			props: {
				...assigneesField.props,
				value: nextValue.join('|'),
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
		const tag = nodeRepo.getTag(tagId);
		const target = nodeRepo.getNode(targetId);
		if (!tag) return failed('Unable to add tag, missing tag');
		if (!target) return failed('Unable to add tag, missing target');

		const tagsField = getOrderedChildren(target.id).find(
			({title}) => title === 'Tags',
		);

		if (!tagsField) return failed('Unable to locate tags field');

		const currentValue =
			tagsField.props.value?.split('|').map(s => s.trim()) ?? [];
		const nextValue = currentValue.includes(tagId)
			? currentValue
			: [...currentValue, tagId];

		nodeRepo.updateNode({
			...tagsField,
			props: {
				...tagsField.props,
				value: nextValue.join('|'),
			},
		});

		return succeeded('Tag added', tag);
	},

	createNodeAtPosition<T extends AnyContext>(
		node: NavNode<T>,
		position: MovePosition = {type: 'end'},
	): Result<NavNode<T>> {
		if (!node.parentNodeId) {
			const withRank = {...node, rank: midRank()};
			this.createNode(withRank);
			return succeeded('Created node', withRank);
		}

		const siblings = getOrderedChildren(node.parentNodeId);
		const rankResult = resolveMoveRank(siblings, position);
		if (isFail(rankResult)) return rankResult;

		const withRank: NavNode<T> = {
			...node,
			rank: rankResult.data,
		};

		this.createNode(withRank);
		return succeeded('Created node', withRank);
	},

	createNode<T extends AnyContext>(node: NavNode<T>) {
		updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[node.id]: node,
			},
		}));

		return node as NavNode<T>;
	},

	updateNode(node: NavNode<AnyContext>) {
		updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[node.id]: node,
			},
		}));

		return node;
	},

	updateNodeAndSelectInParent(node: NavNode<AnyContext>) {
		updateState(s => {
			const nextNodes = {
				...s.nodes,
				[node.id]: node,
			};

			const siblings = Object.values(nextNodes)
				.filter(x => !x.isDeleted && x.parentNodeId === node.parentNodeId)
				.sort((a, b) => a.rank.localeCompare(b.rank));

			return {
				...s,
				nodes: nextNodes,
				currentNodeId: node.parentNodeId,
				selectedIndex: siblings.findIndex(({id}) => id === node.id),
			};
		});

		return node;
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

	getSiblings: (parentId: string) => {
		return Object.values(getState().nodes)
			.filter(x => !x.isDeleted && x.parentNodeId === parentId)
			.sort((a, b) => a.rank.localeCompare(b.rank));
	},
};
