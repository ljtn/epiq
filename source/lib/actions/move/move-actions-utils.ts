import {getState, updateState} from '../../state/state.js';
import {storageManager} from '../../storage/storage-manager.js';
import {navigator} from '../default/navigation-action-utils.js';

export function moveItemInArray<T>({
	array,
	from,
	to,
}: {
	array: readonly T[];
	from: number;
	to: number;
}): readonly T[] {
	const length = array.length;

	if (from < 0 || from >= length || to < 0 || to >= length || from === to) {
		return array;
	}

	const result = array.slice();
	const item = result[from]!;
	result.splice(from, 1);
	result.splice(to, 0, item);
	return result;
}

export function moveNodeToSiblingContainer(direction: -1 | 1) {
	const state = getState();

	const parentNode = state.breadCrumb.at(-2);
	if (!parentNode) return;

	const currentNodeIndex = parentNode.children.findIndex(
		({id}) => id === state.currentNode.id,
	);
	if (currentNodeIndex < 0) return;

	const currentNode = parentNode.children[currentNodeIndex];
	const siblingNode = parentNode.children.at(currentNodeIndex + direction);
	if (!currentNode || !siblingNode) return;

	const fromIndex = state.selectedIndex;
	if (fromIndex < 0 || fromIndex >= currentNode.children.length) return;

	const moveResult = storageManager.move({
		fromParentId: currentNode.id,
		fromIndex,
		toParentId: siblingNode.id,
		toIndex: siblingNode.children.length,
	});

	if (!moveResult?.nodeId) {
		logger.error(
			'moveNodeToSiblingContainer: storageManager.move returned null or no nodeId',
		);
		return;
	}

	updateState(old => {
		const root = old.rootNode;

		const fromParentId = currentNode.id;
		const toParentId = siblingNode.id;

		const patchTree = (node: any): any => {
			if (!node?.children?.length) return node;

			const nextChildren = node.children.map(patchTree);

			if (node.id !== parentNode.id) {
				const changed = nextChildren.some(
					(c: any, i: number) => c !== node.children[i],
				);
				return changed ? {...node, children: nextChildren} : node;
			}

			const fromParent = nextChildren.find((c: any) => c.id === fromParentId);
			const toParent = nextChildren.find((c: any) => c.id === toParentId);
			if (!fromParent || !toParent) return {...node, children: nextChildren};

			const moving = fromParent.children[fromIndex];
			if (!moving) return {...node, children: nextChildren};

			const nextFromKids = fromParent.children.filter(
				(_: any, i: number) => i !== fromIndex,
			);
			const nextToKids = [...toParent.children, moving];

			const nextChildren2 = nextChildren.map((c: any) => {
				if (c.id === fromParentId) return {...c, children: nextFromKids};
				if (c.id === toParentId) return {...c, children: nextToKids};
				return c;
			});

			return {...node, children: nextChildren2};
		};

		const nextRoot = patchTree(root);

		// Rebuild breadcrumb/currentNode by id so they point at tree instances
		const findBreadCrumb = (
			node: any,
			targetId: string,
			path: any[] = [],
		): any[] | undefined => {
			const nextPath = [...path, node];
			if (node.id === targetId) return nextPath;
			for (const child of node.children ?? []) {
				const found = findBreadCrumb(child, targetId, nextPath);
				if (found) return found;
			}
			return;
		};

		const nextBreadCrumb = findBreadCrumb(nextRoot, siblingNode.id);
		if (!nextBreadCrumb) return old;

		return {
			...old,
			rootNode: nextRoot,
			breadCrumb: nextBreadCrumb as any,
			currentNode: nextBreadCrumb.at(-1)!,
			selectedIndex: (nextBreadCrumb.at(-1)!.children.length ?? 1) - 1,
		};
	});

	navigator.navigate({
		currentNode: siblingNode,
		selectedIndex: siblingNode.children.length, // will clamp via breadcrumb instance on navigate()
	});
}

export function moveChildWithinParent(direction: -1 | 1) {
	const state = getState();

	const from = state.selectedIndex;
	const children = state.currentNode.children;
	const to = from + direction;

	if (from < 0 || to < 0 || to >= children.length) return;

	const parentId = state.currentNode.id;

	const moveResult = storageManager.move({
		fromParentId: parentId,
		fromIndex: from,
		toParentId: parentId,
		toIndex: to,
	});

	if (!moveResult?.nodeId) {
		logger.error(
			'moveChildWithinParent: storageManager.move returned null or no nodeId',
		);
		return;
	}

	updateState(old => {
		const reorderAt = (node: any): any => {
			if (!node?.children?.length) return node;

			const nextChildren = node.children.map(reorderAt);

			if (node.id === parentId) {
				const moved = moveItemInArray({array: nextChildren, from, to});
				return {...node, children: moved};
			}

			const changed = nextChildren.some(
				(c: any, i: number) => c !== node.children[i],
			);
			return changed ? {...node, children: nextChildren} : node;
		};

		const nextRoot = reorderAt(old.rootNode);

		const findBreadCrumb = (
			node: any,
			targetId: string,
			path: any[] = [],
		): any[] | undefined => {
			const nextPath = [...path, node];
			if (node.id === targetId) return nextPath;
			for (const child of node.children ?? []) {
				const found = findBreadCrumb(child, targetId, nextPath);
				if (found) return found;
			}
			return;
		};

		const nextBreadCrumb = findBreadCrumb(nextRoot, parentId);
		if (!nextBreadCrumb) return old;

		return {
			...old,
			rootNode: nextRoot,
			breadCrumb: nextBreadCrumb as any,
			currentNode: nextBreadCrumb.at(-1)!,
			selectedIndex: to,
		};
	});

	navigator.navigate({selectedIndex: to});
}
