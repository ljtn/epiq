import {failed, Result, succeeded} from '../model/result-types.js';
import {BreadCrumb} from '../model/app-state.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
export function buildBreadCrumb(
	currentNodeId: string,
	nodes: Record<string, NavNode<AnyContext>>,
	rootNodeId: string,
): Result<BreadCrumb> {
	const currentNode = nodes[currentNodeId];
	if (!currentNode) {
		return failed('buildBreadCrumb(): current node not found');
	}

	const path: NavNode<AnyContext>[] = [];
	let current: NavNode<AnyContext> | undefined = currentNode;

	while (current) {
		path.push(current);

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
