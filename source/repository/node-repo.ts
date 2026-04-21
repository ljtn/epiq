import {MovePosition} from '../event/event.model.js';
import {navigationUtils} from '../lib/actions/default/navigation-action-utils.js';
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
import {nodes} from '../lib/state/node-builder.js';
import {
	getRenderedChildren,
	getState,
	patchState,
	updateState,
} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';
import {sanitizeInlineText} from '../lib/utils/string.utils.js';
import {getOrderedChildren, resolveMoveRank} from './rank.js';

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

export const isDescendantOf = (nodeId: string, ancestorId: string): boolean => {
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
	const state = getState();
	const {renderedChildrenIndex, tags, contributors} = state;
	const visit = (current: NavNode<AnyContext>) => {
		const children = renderedChildrenIndex[current.id];
		if (current.title === fieldName && isFieldListNode(current)) {
			for (const child of children ?? []) {
				if (!child) continue;
				const referencedId =
					typeof child.props?.value === 'string' ? child.props.value : '';

				const refName =
					fieldName === 'Tags'
						? tags[referencedId]?.name
						: fieldName === 'Assignees'
						? contributors[referencedId]?.name
						: undefined;

				const raw = refName ?? child.title ?? String(child.props?.value ?? '');

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

const failIfReadonly = (
	node: NavNode<AnyContext> | undefined,
	action: 'move' | 'rename' | 'edit',
): ReturnFail | null => {
	if (!node) return failed('Node not found');
	if (!node.readonly) return null;

	const msgByAction = {
		move: 'Cannot move readonly node',
		rename: 'Cannot rename readonly node',
		edit: 'Cannot edit readonly node',
	} as const;

	return failed(msgByAction[action]);
};

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

	editValue(targetId: string, md: string): Result<{md: string}> {
		const {nodes} = getState();
		const targetNode = nodes[targetId];
		if (!targetNode) return failed('Edit target node not found');

		const readonlyFail = failIfReadonly(targetNode, 'edit');
		if (readonlyFail) return readonlyFail;

		const updatedNode = {
			...targetNode,
			props: {
				...targetNode.props,
				value: md,
			},
		};

		nodeRepo.updateNode(updatedNode);
		return succeeded('Issue description updated', {md});
	},

	renameNode(targetId: string, title: string): Result<NavNode<AnyContext>> {
		const targetNode = this.getNode(targetId);
		if (!targetNode) return failed('Rename target node not found');

		const readonlyFail = failIfReadonly(targetNode, 'rename');
		if (readonlyFail) return readonlyFail;

		const updatedNode = {
			...targetNode,
			title,
		};

		this.updateNode(updatedNode);
		return succeeded('Renamed node', updatedNode);
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

	getFieldByTitle(parentId: string, title: string) {
		return getOrderedChildren(parentId).find(child => child.title === title);
	},

	moveNode({
		id,
		parentId: nextParentId,
		position = {at: 'end'},
		navigate = true,
	}: {
		id: string;
		parentId: string;
		position?: MovePosition;
		navigate?: boolean;
	}): Result<NavNode<AnyContext>> {
		const {rootNodeId} = getState();
		const node = this.getNode(id);
		const nextParent = this.getNode(nextParentId);

		if (!node) return failed('Node not found');
		if (!nextParent) return failed('Target parent not found');
		if (rootNodeId === id) return failed('Cannot move root node');
		if (id === nextParentId) return failed('Cannot move node into itself');

		const readonlyFail = failIfReadonly(node, 'move');
		if (readonlyFail) return readonlyFail;

		if (isDescendantOf(nextParentId, id)) {
			return failed('Cannot move node into its own descendant');
		}

		const siblings = getOrderedChildren(nextParentId).filter(x => x.id !== id);

		const rankResult = resolveMoveRank(siblings, position);
		if (isFail(rankResult)) return rankResult;

		const movedNode = {
			...node,
			parentNodeId: nextParentId,
			rank: rankResult.data,
		};

		if (navigate) {
			this.updateNodeAndSelectInParent(movedNode);
		} else {
			this.updateNode(movedNode);
		}

		return succeeded('Moved node successfully', movedNode);
	},

	tombstoneNode(nodeId: string): Result<NavNode<AnyContext>> {
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

		const nextCurrentNodeId = !idsToDelete.has(currentNodeId)
			? currentNodeId
			: node.parentNodeId ?? rootNodeId;

		patchState({
			nodes: nextNodes,
		});

		navigationUtils.navigate({
			currentNode: nextNodes[nextCurrentNodeId],
			selectedIndex: 0,
		});

		return succeeded('Successfully tomb stoned', node);
	},

	createContributor(contributor: Contributor): Result<Contributor> {
		const result = updateState(s => ({
			...s,
			contributors: {
				...s.contributors,
				[contributor.id]: contributor,
			},
		}));
		if (isFail(result)) return failed('Unable to create contributor');
		return succeeded('Created contributor', contributor);
	},

	assign(targetId: string, contributorId: string, assignmentNodeId: string) {
		const contributor = nodeRepo.getContributor(contributorId);
		const target = nodeRepo.getNode(targetId);
		if (!target || !contributor) {
			return failed('Unable assign contributor to issue');
		}

		const assigneesField = this.getFieldByTitle(target.id, 'Assignees');
		if (!assigneesField) return failed('Unable to locate assignees field');

		const alreadyAssigned = getOrderedChildren(assigneesField.id).some(
			child => child.props?.value === contributorId,
		);

		if (alreadyAssigned) {
			return failed('Contributor already assigned');
		}

		const result = this.createNodeAtPosition(
			nodes.field(assignmentNodeId, contributor.name, assigneesField.id, {
				value: contributorId,
			}),
		);

		if (isFail(result)) return result;
		return succeeded('Assigned contributor', result.data);
	},

	createTag(tag: Tag): Result<Tag> {
		const result = updateState(s => ({
			...s,
			tags: {
				...s.tags,
				[tag.id]: tag,
			},
		}));
		if (isFail(result)) return failed('Could not create tag');
		return succeeded('Tag created', tag);
	},

	tag(
		targetId: string,
		tagId: string,
		tagNodeId: string,
	): Result<NavNode<'FIELD'>> {
		const tag = nodeRepo.getTag(tagId);
		const target = nodeRepo.getNode(targetId);
		if (!tag) return failed('Unable to add tag, missing tag');
		if (!target) return failed('Unable to add tag, missing target');

		const tagsField = this.getFieldByTitle(target.id, 'Tags');
		if (!tagsField) return failed('Unable to locate tags field');

		const alreadyTagged = getOrderedChildren(tagsField.id).some(
			child => child.props?.value === tagId,
		);

		if (alreadyTagged) {
			return failed('Tag already assigned');
		}

		const result = this.createNodeAtPosition(
			nodes.field(tagNodeId, tag.name, tagsField.id, {
				value: tagId,
			}),
		);

		if (isFail(result)) return result;
		return succeeded('Tag added', result.data);
	},

	createNodeAtPosition<T extends AnyContext>(
		node: NavNode<T>,
		position: MovePosition = {at: 'end'},
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

	createNode<T extends AnyContext>(
		node: NavNode<T>,
	): Result<NavNode<AnyContext>> {
		const result = updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[node.id]: node,
			},
		}));
		if (!isFail(result)) return failed('Unable to create node');

		return succeeded('Node created', node);
	},

	lockNode(id: string): Result<NavNode<AnyContext>> {
		const node = this.getNode(id);
		if (!node) return failed('Failed to locate node');

		const updatedNode: NavNode<AnyContext> = {
			...node,
			readonly: true,
		};

		const result = updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[id]: updatedNode,
			},
		}));
		if (isFail(result)) return failed(result.message);

		return succeeded('Locked node', updatedNode);
	},

	updateNode(node: NavNode<AnyContext>) {
		const result = updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[node.id]: node,
			},
		}));

		if (!isFail(result)) return result;
		return succeeded('Updated node', node);
	},

	updateNodeAndSelectInParent(
		node: NavNode<AnyContext>,
	): Result<NavNode<AnyContext>> {
		const updateResult = updateState(s => ({
			...s,
			nodes: {
				...s.nodes,
				[node.id]: node,
			},
		}));

		if (isFail(updateResult)) return failed(updateResult.message);

		const state = getState();
		const newCurrentNode = node.parentNodeId
			? state.nodes[node.parentNodeId]
			: state.nodes[state.rootNodeId];

		if (!newCurrentNode) {
			return failed('Unable to resolve parent after update');
		}

		const renderedSiblings = getRenderedChildren(newCurrentNode.id);
		const selectedIndex = renderedSiblings.findIndex(({id}) => id === node.id);

		navigationUtils.navigate({
			currentNode: newCurrentNode,
			selectedIndex: selectedIndex === -1 ? 0 : selectedIndex,
		});

		return succeeded('Updated and selected', node);
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
