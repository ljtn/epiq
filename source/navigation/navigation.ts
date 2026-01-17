import readline from 'readline';
import {NavigateCtx} from './model/navigation-ctx.model.js';
import {NavigationTree} from './model/navigation-tree.model.js';
import {navigationState} from './state/state.js';
import {getKeyIntent} from './utils/key-intent.js';

export function navigate<T extends NavigationTree>({
	index = 0,
	breadCrumb,
	callbacks,
}: {
	index: number;
	breadCrumb: Array<NavigationTree<NavigationTree>>;
	callbacks: Partial<{
		render: () => void;
		onSelectChange: (
			s: T['children'][number],
			breadCrumb: T['children'],
		) => void;
		onConfirm: (s: T['children'][number]) => void;
	}>;
}) {
	const {
		render = () => {},
		onSelectChange = () => {},
		onConfirm = () => {},
	} = callbacks;

	const ctx: NavigateCtx = {
		breadCrumb,
		get navigationNode() {
			return this.breadCrumb.at(-1)!;
		},
		get children() {
			return this.navigationNode.children ?? [];
		},
		selectNone: () => {
			ctx.select(-1);
		},
		_selectedIndex: 0,
		getSelectedIndex() {
			return this._selectedIndex;
		},
		select(i) {
			this._selectedIndex = i;
			updateSelection(ctx.navigationNode, breadCrumb, i, onSelectChange);
		},
		render,
		reInvokeNavigate(index, breadCrumb) {
			return reInvokeNavigate(index, breadCrumb);
		},
		confirm: sel => onConfirm(sel as any),
		exit: () => {
			cleanup();
			process.exit(0);
		},
		enterChildNode: node => reInvokeNavigate(0, [...breadCrumb, node]),
		enterParentNode: () => {
			ctx.select(-1); // Clear all on this level
			if (breadCrumb.length < 2) return; // Need at least grandparent + parent

			const ancestors = breadCrumb;
			const parent = ancestors[ancestors.length - 1];
			const grandParent = ancestors[ancestors.length - 2];
			if (!parent || !grandParent) return;
			const parentIndex = grandParent?.children.findIndex(
				x => parent.id === x.id,
			);
			reInvokeNavigate(parentIndex, breadCrumb.slice(0, -1)); // Go to parent level
		},
	};

	ctx.select(index);

	function onKeyPress(_: string, key: readline.Key) {
		if (key.ctrl && key.name === 'c') return ctx.exit();

		const filteredActions = navigationState.availableActions.filter(
			x => x.mode === navigationState.mode,
		);

		const actionMeta = filteredActions?.find(actionMetaItem => {
			const intent = getKeyIntent(key, ctx, actionMetaItem.mode);
			return intent === actionMetaItem.intent;
		});
		actionMeta?.action?.(ctx, actionMeta);

		ctx.render();
	}

	const cleanup = () => process.stdin.removeListener('keypress', onKeyPress);

	const reInvokeNavigate = (idx: number, crumb: typeof breadCrumb) => {
		cleanup();
		navigate({index: idx, breadCrumb: [...crumb], callbacks});
	};

	render();

	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) process.stdin.setRawMode(true);
	process.stdin.on('keypress', onKeyPress);
}

function updateSelection<T>(
	{children}: NavigationTree<T>,
	breadCrumb: NavigationTree<T>[],
	idx: number,
	onSelectChange: (
		selection: (typeof children)[number],
		breadCrumb: typeof children,
	) => void,
) {
	children.forEach((c, i) => (c.isSelected = i === idx));
	onSelectChange(children[idx] as any, breadCrumb);
}
