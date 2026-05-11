import {Contributor, Tag} from '../model/app-state.model.js';
import {AnyContext, isTicketNode} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {
	failed,
	isFail,
	Result,
	ReturnFail,
	succeeded,
} from '../model/result-types.js';
import {getState, patchState, updateState} from '../state/state.js';
import {getOrderedChildren} from './rank.js';

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
				description: md,
			},
		};

		this.updateNode(updatedNode);
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

	moveNodeToRank({
		id,
		parentId: nextParentId,
		rank,
	}: {
		id: string;
		parentId: string;
		rank: string;
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

		const movedNode = {
			...node,
			parentNodeId: nextParentId,
			rank,
		};

		this.updateNode(movedNode);

		return succeeded('Moved node successfully', movedNode);
	},

	tombstoneNode(nodeId: string): Result<NavNode<AnyContext>> {
		const {nodes, contextNodeId, rootNodeId} = getState();

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

		if (!contextNodeId) return failed('Unable to delete undefined');

		patchState({nodes: nextNodes});

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

	assign(targetId: string, contributorId: string): Result<{assignee: string}> {
		const contributor = this.getContributor(contributorId);
		const target = this.getNode(targetId);

		if (!contributor)
			return failed('Unable to assign contributor, missing contributor');
		if (!target) return failed('Unable to assign contributor, missing target');

		const readonlyFail = failIfReadonly(target, 'edit');
		if (readonlyFail) return readonlyFail;

		if (!isTicketNode(target)) return failed('Target is not an issue');
		const assignees = target.props.assignees ?? [];

		if (assignees.includes(contributorId)) {
			return failed('Contributor already assigned');
		}

		const updatedNode = {
			...target,
			props: {
				...target.props,
				assignees: [...assignees, contributorId],
			},
		};

		this.updateNode(updatedNode);

		return succeeded('Assigned contributor', {assignee: contributorId});
	},

	unassign(
		targetId: string,
		contributorId: string,
	): Result<{assignee: string}> {
		const contributor = this.getContributor(contributorId);
		const target = this.getNode(targetId);

		if (!contributor) return failed('Unable to unassign, missing contributor');
		if (!target) return failed('Unable to unassign, missing target');

		const readonlyFail = failIfReadonly(target, 'edit');
		if (readonlyFail) return readonlyFail;

		if (!isTicketNode(target)) return failed('Target is not an issue');
		const assignees = target.props.assignees ?? [];

		if (!assignees.includes(contributorId)) {
			return succeeded('Issue is not assigned to that contributor', {
				assignee: contributorId,
			});
		}

		const updatedNode = {
			...target,
			props: {
				...target.props,
				assignees: assignees.filter(id => id !== contributorId),
			},
		};

		this.updateNode(updatedNode);

		return succeeded('Assignee removed', {assignee: contributorId});
	},

	tag(targetId: string, tagId: string): Result<{tag: string}> {
		const tag = this.getTag(tagId);
		const target = this.getNode(targetId);

		if (!tag) return failed('Unable to add tag, missing tag');
		if (!target) return failed('Unable to add tag, missing target');

		const readonlyFail = failIfReadonly(target, 'edit');
		if (readonlyFail) return readonlyFail;

		if (!isTicketNode(target)) return failed('Target is not an issue');
		const tags = target.props.tags ?? [];

		if (tags.includes(tagId)) {
			return failed('Tag already assigned');
		}

		const updatedNode = {
			...target,
			props: {
				...target.props,
				tags: [...tags, tagId],
			},
		};

		this.updateNode(updatedNode);

		return succeeded('Tag added', {tag: tagId});
	},

	untag(targetId: string, tagId: string): Result<{tag: string}> {
		const tag = this.getTag(tagId);
		const target = this.getNode(targetId);

		if (!tag) return failed('Unable to remove tag, missing tag');
		if (!target) return failed('Unable to remove tag, missing target');

		const readonlyFail = failIfReadonly(target, 'edit');
		if (readonlyFail) return readonlyFail;

		if (!isTicketNode(target)) return failed('Target is not an issue');
		const tags = target.props.tags ?? [];

		if (!tags.includes(tagId)) {
			return succeeded('Issue is not tagged with that tag', {tag: tagId});
		}

		const updatedNode = {
			...target,
			props: {
				...target.props,
				tags: tags.filter(id => id !== tagId),
			},
		};

		this.updateNode(updatedNode);

		return succeeded('Tag removed', {tag: tagId});
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

	getSiblings(parentId: string) {
		return getOrderedChildren(parentId);
	},
};
