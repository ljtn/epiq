import {MovePosition} from '../event/event.model.js';
import {
	failed,
	isFail,
	succeeded,
	Result,
	ReturnFail,
} from '../model/result-types.js';
import {Contributor, Tag} from '../model/app-state.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {nodes} from '../state/node-builder.js';
import {getState, patchState, updateState} from '../state/state.js';
import {midRank} from '../utils/rank.js';
import {getOrderedChildren, resolveMoveRank} from './rank.js';

export const findAncestor = <T extends AnyContext>(
	targetId: string,
	ctx: T,
): Result<NavNode<T>> => {
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
		const {tags} = getState();

		return [
			...new Set(
				Object.values(tags)
					.map(node => node.name)
					.filter(Boolean),
			),
		];
	},

	getExistingAssignees(): string[] {
		const {contributors} = getState();

		return [
			...new Set(
				Object.values(contributors)
					.map(node => node.name)
					.filter(Boolean),
			),
		];
	},

	getFieldByTitle(parentId: string, title: string) {
		return getOrderedChildren(parentId).find(child => child.title === title);
	},

	moveNode({
		id,
		parentId: nextParentId,
		position = {at: 'end'},
	}: {
		id: string;
		parentId: string;
		position?: MovePosition;
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
			rank: rankResult.value,
		};

		this.updateNode(movedNode);

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

		patchState({
			nodes: nextNodes,
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
		return succeeded('Assigned contributor', result.value);
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
		return succeeded('Tag added', result.value);
	},

	untag(targetId: string, tagId: string): Result<NavNode<'FIELD'>> {
		const tag = nodeRepo.getTag(tagId);
		const target = nodeRepo.getNode(targetId);
		if (!tag) return failed('Unable to remove tag, missing tag');
		if (!target) return failed('Unable to remove tag, missing target');

		const tagsField = this.getFieldByTitle(target.id, 'Tags');
		if (!tagsField) return failed('Unable to locate tags field');

		const tagNode = getOrderedChildren(tagsField.id).find(
			child => child.props?.value === tagId,
		);

		if (!tagNode) {
			return succeeded('Issue is not tagged with that tag', null);
		}

		const nextNode: NavNode<'FIELD'> = {
			...(tagNode as NavNode<'FIELD'>),
			isDeleted: true,
		};

		this.updateNode(nextNode);

		return succeeded('Tag removed', nextNode);
	},

	unassign(targetId: string, contributorId: string): Result<NavNode<'FIELD'>> {
		const contributor = nodeRepo.getContributor(contributorId);
		const target = nodeRepo.getNode(targetId);

		if (!contributor) return failed('Unable to unassign, missing contributor');
		if (!target) return failed('Unable to unassign, missing target');

		const assigneesField = this.getFieldByTitle(target.id, 'Assignees');
		if (!assigneesField) return failed('Unable to locate assignees field');

		const assigneeNode = getOrderedChildren(assigneesField.id).find(
			child => child.props?.value === contributorId,
		);

		if (!assigneeNode) {
			return succeeded('Issue is not assigned to that contributor', null);
		}

		const nextNode: NavNode<'FIELD'> = {
			...(assigneeNode as NavNode<'FIELD'>),
			isDeleted: true,
		};

		this.updateNode(nextNode);

		return succeeded('Assignee removed', nextNode);
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
			rank: rankResult.value,
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
		if (isFail(result)) return failed('Unable to create node');

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

		if (isFail(result)) return result;
		return succeeded('Updated node', node);
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
