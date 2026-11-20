// Lookups beside the state, kept as of the map each was read from. They hold
// only while every write to those maps goes through `setStateEntry`.

import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {nodeRef} from '../utils/node-ref.js';

// Node ids by what each node is, as of the node map they were read from: a
// write carries them along, a map replaced whole has them read again.
let nodeKinds: {
	nodes: Record<string, NavNode<AnyContext>>;
	byContext: Map<string, Set<string>>;
} | null = null;

const kindsRead = (nodes: Record<string, NavNode<AnyContext>>) => {
	if (nodeKinds?.nodes === nodes) return nodeKinds;

	const byContext = new Map<string, Set<string>>();
	for (const [id, node] of Object.entries(nodes)) {
		let ids = byContext.get(node.context);
		if (!ids) byContext.set(node.context, (ids = new Set()));
		ids.add(id);
	}
	return (nodeKinds = {nodes, byContext});
};

// Node ids by the full ref each shortens to, which is not unique: built only
// once a ref is looked up, kept the same way.
let nodeRefs: {
	nodes: Record<string, NavNode<AnyContext>>;
	byRef: Map<string, string[] | string>;
} | null = null;

const refsRead = (nodes: Record<string, NavNode<AnyContext>>) => {
	if (nodeRefs?.nodes === nodes) return nodeRefs;

	nodeRefs = {nodes, byRef: new Map()};
	for (const id of Object.keys(nodes)) addRef(nodeRefs.byRef, id);
	return nodeRefs;
};

// A lone id is held bare: most refs name one node.
const addRef = (byRef: Map<string, string[] | string>, id: string): void => {
	const ref = nodeRef(id);
	const same = byRef.get(ref);
	if (same === undefined) byRef.set(ref, id);
	else if (typeof same === 'string') byRef.set(ref, [same, id]);
	else same.push(id);
};

const NO_IDS: ReadonlySet<string> = new Set();

/** Ids of every node of `context` in `nodes`, deleted ones included, in its order. */
export const nodeIdsOfKind = (
	nodes: Record<string, NavNode<AnyContext>>,
	context: AnyContext,
): ReadonlySet<string> => kindsRead(nodes).byContext.get(context) ?? NO_IDS;

/** Ids of every node in `nodes` whose full ref is `ref`, in its order. */
export const nodeIdsWithRefIn = (
	nodes: Record<string, NavNode<AnyContext>>,
	ref: string,
): readonly string[] => {
	const ids = refsRead(nodes).byRef.get(ref);
	return ids === undefined ? [] : typeof ids === 'string' ? [ids] : ids;
};

// One node written: the index read from `from` holds for `to` with it.
const noteNodeKind = (
	from: Record<string, unknown>,
	to: Record<string, unknown>,
	id: string,
	before: NavNode<AnyContext> | undefined,
	after: NavNode<AnyContext>,
): void => {
	if (nodeRefs?.nodes === from) {
		if (!before) addRef(nodeRefs.byRef, id);
		nodeRefs.nodes = to as Record<string, NavNode<AnyContext>>;
	}
	if (!nodeKinds || nodeKinds.nodes !== from) return;
	if (before && before.context !== after.context) {
		nodeKinds.byContext.get(before.context)?.delete(id);
	}
	let ids = nodeKinds.byContext.get(after.context);
	if (!ids) nodeKinds.byContext.set(after.context, (ids = new Set()));
	ids.add(id);
	nodeKinds.nodes = to as Record<string, NavNode<AnyContext>>;
};

// Comment and attachment ids by the ticket each belongs to, as of the map
// they were read from, kept the same way as the kinds above.
export type IssueKeyed = 'comments' | 'attachments';
const byIssue: Partial<
	Record<IssueKeyed, {map: object; ids: Map<string, string[]>}>
> = {};

/** Ids of every comment or attachment of `issueId` in `map`, deleted ones included, in its order. */
export const entryIdsOfIssueIn = (
	key: IssueKeyed,
	map: Record<string, {issue: string}>,
	issueId: string,
): readonly string[] => {
	let held = byIssue[key];
	if (held?.map !== map) {
		const ids = new Map<string, string[]>();
		for (const [id, entry] of Object.entries(map)) {
			const list = ids.get(entry.issue);
			if (list) list.push(id);
			else ids.set(entry.issue, [id]);
		}
		byIssue[key] = held = {map, ids};
	}
	return held.ids.get(issueId) ?? [];
};

const noteIssueEntry = (
	key: IssueKeyed,
	from: object,
	to: object,
	id: string,
	before: {issue: string} | undefined,
	after: {issue: string},
): void => {
	const held = byIssue[key];
	if (!held || held.map !== from) return;
	if (before?.issue !== after.issue) {
		if (before) {
			const list = held.ids.get(before.issue);
			if (list)
				held.ids.set(
					before.issue,
					list.filter(other => other !== id),
				);
		}
		const list = held.ids.get(after.issue);
		if (list) list.push(id);
		else held.ids.set(after.issue, [id]);
	}
	held.map = to;
};

// One entry written: every index read from `from` holds for `to` with it.
export const noteEntry = (
	key: string,
	from: Record<string, unknown>,
	to: Record<string, unknown>,
	id: string,
	before: unknown,
	after: unknown,
): void => {
	if (key === 'nodes') {
		noteNodeKind(
			from,
			to,
			id,
			before as NavNode<AnyContext> | undefined,
			after as NavNode<AnyContext>,
		);
	} else if (key === 'comments' || key === 'attachments') {
		noteIssueEntry(
			key,
			from,
			to,
			id,
			before as {issue: string} | undefined,
			after as {issue: string},
		);
	}
};

/**
 * Where an index held for these maps disagrees with a scan of them: none,
 * unless something wrote to a map around `setStateEntry`.
 */
export const heldIndexDisagreements = (maps: {
	nodes: Record<string, NavNode<AnyContext>>;
	comments: Record<string, {issue: string}>;
	attachments: Record<string, {issue: string}>;
}): string[] => {
	const found: string[] = [];
	const same = (label: string, held: readonly string[], scanned: string[]) => {
		if (held.join('\n') !== scanned.join('\n')) found.push(label);
	};

	const all = Object.values(maps.nodes);
	if (nodeKinds?.nodes === maps.nodes) {
		const contexts = new Set([
			...all.map(node => node.context),
			...nodeKinds.byContext.keys(),
		]);
		for (const context of contexts) {
			same(
				`nodes of ${context}`,
				[...(nodeKinds.byContext.get(context) ?? [])],
				all.filter(node => node.context === context).map(node => node.id),
			);
		}
	}
	if (nodeRefs?.nodes === maps.nodes) {
		const refs = new Set([
			...all.map(node => nodeRef(node.id)),
			...nodeRefs.byRef.keys(),
		]);
		for (const ref of refs) {
			same(
				`nodes with ref ${ref}`,
				nodeIdsWithRefIn(maps.nodes, ref),
				all.filter(node => nodeRef(node.id) === ref).map(node => node.id),
			);
		}
	}
	for (const key of ['comments', 'attachments'] as const) {
		const held = byIssue[key];
		if (held?.map !== maps[key]) continue;
		const entries = Object.entries(maps[key]);
		const issues = new Set([
			...entries.map(([, entry]) => entry.issue),
			...held.ids.keys(),
		]);
		for (const issue of issues) {
			same(
				`${key} of ${issue}`,
				held.ids.get(issue) ?? [],
				entries.filter(([, entry]) => entry.issue === issue).map(([id]) => id),
			);
		}
	}

	return found;
};
