import readline from 'readline';
import {NavigationTree} from './types/navigation.model.js';
import {ActionEntry} from './types/action-map.model.js';
import {NavigateCtx} from './navigation-context.js';
import {buildDefaultActions} from './default-actions.js';

export function navigate<T extends NavigationTree>({
	breadCrumb,
	callbacks,
}: {
	breadCrumb: Array<NavigationTree<NavigationTree>>;
	callbacks: Partial<{
		render: () => void;
		onSelectChange: (s: T['children'][number]) => void;
		onConfirm: (s: T['children'][number]) => void;
		actionMap: ActionEntry<[NavigateCtx]>[];
	}>;
}) {
	const {
		render = () => {},
		onSelectChange = () => {},
		onConfirm = () => {},
		actionMap: userActions = [],
	} = callbacks;

	const ctx: NavigateCtx = {
		breadCrumb,
		get navigationNode() {
			return this.breadCrumb.at(-1)!;
		},
		get children() {
			return this.navigationNode.children ?? [];
		},
		select: index => {
			ctx.setSelectedIndex(index);
			ctx.updateSelection(index);
		},
		selectNone: () => {
			ctx.select(-1);
		},
		_selectedIndex: 0,
		getSelectedIndex() {
			return this._selectedIndex;
		},
		setSelectedIndex(i) {
			this._selectedIndex = i;
		},
		updateSelection: idx =>
			updateSelection(ctx.navigationNode, idx, onSelectChange),
		render,
		confirm: sel => onConfirm(sel as any),
		exit: () => {
			cleanup();
			process.exit(0);
		},
		push: node => reInvokeNavigate([...breadCrumb, node]),
		pop: () => reInvokeNavigate(breadCrumb.slice(0, -1)),
	};

	if (ctx.children.length === 0) return;
	ctx._selectedIndex = Math.max(
		0,
		ctx.children.findIndex(c => c.isSelected),
	);
	ctx.updateSelection(ctx._selectedIndex);

	function onKeyPress(_: string, key: readline.Key) {
		if (key.ctrl && key.name === 'c') return ctx.exit();

		const action = [...buildDefaultActions(), ...userActions]?.find(
			a => a.key === key.name,
		);
		action?.action(ctx);

		ctx.render();
	}

	const cleanup = () => process.stdin.removeListener('keypress', onKeyPress);

	const reInvokeNavigate = (crumb: typeof breadCrumb) => {
		cleanup();
		navigate({breadCrumb: crumb, callbacks});
	};

	render();

	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) process.stdin.setRawMode(true);
	process.stdin.on('keypress', onKeyPress);
}

function updateSelection<T>(
	{children}: NavigationTree<T>,
	idx: number,
	onSelectChange: (sel: (typeof children)[number]) => void,
) {
	children.forEach((c, i) => (c.isSelected = i === idx));
	onSelectChange(children[idx] as any);
}
