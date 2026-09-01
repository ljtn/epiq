import {failed, Result, succeeded} from '../model/result-types.js';
import {BreadCrumb} from '../model/app-state.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
export function buildBreadCrumb(
	contextNodeId: string,
	nodes: Record<string, NavNode<AnyContext>>,
	rootNodeId: string,
): Result<BreadCrumb> {
	const contextNode = nodes[contextNodeId];
	if (!contextNode) {
		return failed('buildBreadCrumb(): current node not found');
	}

	const path: NavNode<AnyContext>[] = [];
	// Bounded on nodes already seen: this walk runs inside `derive`, so a loop
	// in the node map would hang every render rather than fail one lookup.
	// A loop cannot reach the root, so stopping leaves the "not connected to
	// root" failure below to report it.
	const seen = new Set<string>();
	let current: NavNode<AnyContext> | undefined = contextNode;

	while (current && !seen.has(current.id)) {
		path.push(current);
		seen.add(current.id);

		if (current.id === rootNodeId) break;
		if (!current.parentNodeId) break;

		current = nodes[current.parentNodeId];
	}

	const last = path[path.length - 1];
	if (!last || last.id !== rootNodeId) {
		return failed('buildBreadCrumb(): node is not connected to root');
	}

	path.reverse();

	return succeeded('Breadcrumb built', path as BreadCrumb);
}
