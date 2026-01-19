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
			s: T['children'][number] | undefined,
			breadCrumb: T['children'],
		) => void;
		onConfirm: (s: T['children'][number]) => void;
	}>;
}) {
	const ctx: NavigateCtx = {
		_selectionIndex: 0,
		breadCrumb: breadCrumb,
		render() {
			callbacks.render?.();
		},
		get navigationNode() {
			return this.breadCrumb?.at(-1)! ?? breadCrumb[0];
		},
		get children() {
			return this.navigationNode.children ?? [];
		},
		selectNone() {
			ctx.updateSelection(-1);
		},
		getSelectedIndex() {
			return this._selectionIndex;
		},
		updateSelection(idx) {
			this._selectionIndex = idx;
			const children = this.navigationNode.children ?? [];
			children.forEach((c, i) => (c.isSelected = i === idx));
			if (idx < 0 || idx >= children.length) {
				callbacks.onSelectChange?.(undefined, breadCrumb);
				return;
			}
			callbacks.onSelectChange?.(children[idx], breadCrumb);
		},
		reInvokeNavigate(idx: number, crumb: typeof breadCrumb) {
			cleanup();
			navigate({index: idx, breadCrumb: [...crumb], callbacks});
		},
		confirm(sel) {
			return callbacks.onConfirm?.(sel);
		},
		exit() {
			cleanup();
			process.exit(0);
		},
		enterChildNode(childNode) {
			this.updateSelection(-1); // Clear all on this level
			this.reInvokeNavigate(0, [...breadCrumb, childNode]);
		},
		enterParentNode() {
			ctx.updateSelection(-1); // Clear all on this level
			if (breadCrumb.length < 2) return; // Need at least grandparent + parent

			const ancestors = breadCrumb;
			const parent = ancestors[ancestors.length - 1];
			const grandParent = ancestors[ancestors.length - 2];
			if (!parent || !grandParent) return;
			const parentIndex = grandParent?.children.findIndex(
				x => parent.id === x.id,
			);
			this.reInvokeNavigate(parentIndex, breadCrumb.slice(0, -1)); // Go to parent level
		},
	};

	ctx.updateSelection(index);

	async function onKeyPress(_: string, key: readline.Key) {
		if (key.ctrl && key.name === 'c') return ctx.exit();

		const filteredActions = navigationState.availableActions.filter(
			x => x.mode === navigationState.mode,
		);

		const actionMeta = filteredActions.find(actionMetaItem => {
			const intent = getKeyIntent(key, ctx, actionMetaItem.mode);
			return intent === actionMetaItem.intent;
		});

		if (actionMeta?.action) {
			try {
				const res = actionMeta.action(ctx, actionMeta, key);
				if (res instanceof Promise) await res;
			} catch (err) {
				console.error(err);
			}
		}

		ctx.render();
	}

	const cleanup = () => process.stdin.removeListener('keypress', onKeyPress);

	callbacks.render?.();

	readline.emitKeypressEvents(process.stdin);
	if (process.stdin.isTTY) process.stdin.setRawMode(true);
	process.stdin.on('keypress', onKeyPress);
}
