import readline from 'readline';
import {NavigationTree} from './types/navigation.model.js';

const updateSelection = <T>(
	{children}: NavigationTree<T>,
	idx: number,
	onSelectChange: (selected: (typeof children)[number]) => void,
) => {
	children.forEach((c, i) => (c.isSelected = i === idx));
	const selected = children[idx];
	onSelectChange(selected as any);
};

export function navigate<T extends NavigationTree>({
	breadCrumb,
	callbacks,
}: {
	breadCrumb: Array<NavigationTree<NavigationTree>>;
	callbacks: Partial<{
		render: () => void;
		onSelectChange: (selected: T['children'][number]) => void;
		onExit: (selected: T['children'][number]) => void;
	}>;
}): void {
	const {
		render = () => {},
		onSelectChange = () => {},
		onExit = () => {},
	} = callbacks;

	const navigationNode = breadCrumb.at(-1);
	if (!navigationNode) {
		return;
	}

	const children = navigationNode.children ?? [];
	if (children.length === 0) {
		return;
	}

	let selectedIndex = children.findIndex(c => c.isSelected);
	if (selectedIndex === -1) selectedIndex = 0;

	updateSelection(navigationNode, selectedIndex, onSelectChange);
	const onKeyPress = (
		_: string,
		key: {
			name?: string;
			ctrl: boolean;
			meta: boolean;
			shift: boolean;
			sequence: string;
		},
	) => {
		const selected = children[selectedIndex];
		const navMode = children[0]?.navigationMode || 'vertical';
		if (!selected) return;

		if (key.ctrl && key.name === 'c') {
			exit();
			return;
		}

		switch (key.name) {
			case 'return':
				updateSelection(navigationNode, -1, onSelectChange);
				if (!selected.children?.length) return onExit(selected);
				return prepareNavigation()({
					breadCrumb: [...breadCrumb, selected],
					callbacks,
				});

			case 'escape': {
				const navigationNode = breadCrumb.at(-1);
				const grandParent = breadCrumb.at(-2);

				if (!navigationNode || !grandParent) {
					return exit();
				}

				// Deselect the current node
				updateSelection(navigationNode, -1, onSelectChange);

				// Reselect the parent in its own parent (i.e., grandparent)
				const parentIndex = grandParent.children.findIndex(
					child => child.id === navigationNode.id,
				);
				if (parentIndex !== -1) {
					updateSelection(grandParent, parentIndex, onSelectChange);
				}

				return prepareNavigation()({
					breadCrumb: breadCrumb.slice(0, -1),
					callbacks,
				});
			}

			case 'up':
			case 'left':
				if (
					(navMode === 'vertical' && key.name === 'up') ||
					(navMode === 'horizontal' && key.name === 'left')
				) {
					selectedIndex =
						(selectedIndex - 1 + children.length) % children.length;
					updateSelection(navigationNode, selectedIndex, onSelectChange);
				}
				break;

			case 'down':
			case 'right':
				if (
					(navMode === 'vertical' && key.name === 'down') ||
					(navMode === 'horizontal' && key.name === 'right')
				) {
					selectedIndex = (selectedIndex + 1) % children.length;
					updateSelection(navigationNode, selectedIndex, onSelectChange);
				}
				break;

			default:
				return;
		}

		render();
	};

	const cleanup = () => {
		process.stdin.removeListener('keypress', onKeyPress);
	};

	const prepareNavigation = () => {
		cleanup();
		return navigate;
	};

	const exit = () => {
		cleanup();
		process.stdin.setRawMode(false);
		process.stdin.pause();
		process.exit();
	};

	render();

	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
	}
	process.stdin.on('keypress', onKeyPress);
}
