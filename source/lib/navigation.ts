import {NavigationTree} from './types/navigation.model.js';
import {keys} from './utils.js';

const cleanup = () => {
	process.stdin.removeAllListeners('data');
	process.stdin.setRawMode(false);
	process.stdin.pause();
};

const exit = () => {
	cleanup();
	process.exit();
};

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

	const targetParent = breadCrumb.at(-1);
	if (!targetParent) {
		console.warn('Empty breadCrumb — nothing to navigate.');
		return;
	}

	const children = targetParent.children ?? [];

	if (children.length === 0) {
		console.warn('No children to navigate.');
		return;
	}

	let selectedIndex = children.findIndex(c => c.isSelected);
	if (selectedIndex === -1) selectedIndex = 0;

	updateSelection(targetParent, selectedIndex, onSelectChange);

	const onKeyPress = (key: string) => {
		if (!key) return;
		const selected = children[selectedIndex];
		const navMode = children[0]?.navigationMode || 'vertical';
		if (!selected) return;

		switch (key) {
			case keys.CTRL_C:
				exit();
				return;

			case keys.ENTER:
				updateSelection(targetParent, -1, onSelectChange);
				if (!selected.children?.length) return onExit(selected);
				return navigate({
					breadCrumb: [...breadCrumb, selected],
					callbacks,
				});

			case keys.ESCAPE:
				const parent = breadCrumb.at(-1);
				if (!parent) return exit();
				updateSelection(targetParent, -1, onSelectChange);
				return navigate({
					breadCrumb: breadCrumb.slice(0, -1),
					callbacks,
				});

			case keys.ARROW_UP:
			case keys.ARROW_LEFT:
				if (
					(navMode === 'vertical' && key === keys.ARROW_UP) ||
					(navMode === 'horizontal' && key === keys.ARROW_LEFT)
				) {
					selectedIndex =
						(selectedIndex - 1 + children.length) % children.length;
					updateSelection(targetParent, selectedIndex, onSelectChange);
				}
				break;

			case keys.ARROW_DOWN:
			case keys.ARROW_RIGHT:
				if (
					(navMode === 'vertical' && key === keys.ARROW_DOWN) ||
					(navMode === 'horizontal' && key === keys.ARROW_RIGHT)
				) {
					selectedIndex = (selectedIndex + 1) % children.length;
					updateSelection(targetParent, selectedIndex, onSelectChange);
				}
				break;

			default:
				return;
		}

		render();
	};

	cleanup(); // in case this isn't the first time
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', onKeyPress);

	render();
}
