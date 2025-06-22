import readline from 'readline';
import {NavigateCtx} from '../model/navigation-ctx.model.js';

export enum KeyIntent {
	NavPreviousItem = 'nav-previous-item',
	NavNextItem = 'nav-next-item',
	NavToPreviousContainer = 'nav-to-previous-container',
	NavToNextContainer = 'nav-to-next-container',

	MovePreviousItem = 'move-previous-item',
	MoveNextItem = 'move-next-item',
	MoveToPreviousContainer = 'move-to-previous-container',
	MoveToNextContainer = 'move-to-next-container',

	Confirm = 'confirm',
	Exit = 'exit',
	ToggleHelp = 'toggle-help',
}

export function getKeyIntent(
	key: readline.Key,
	ctx: NavigateCtx,
): KeyIntent | null {
	const axis = ctx.navigationNode.childrenRenderAxis;

	if (key.shift) {
		switch (key.name) {
			case 'up':
				return axis === 'vertical' ? KeyIntent.MovePreviousItem : null;
			case 'down':
				return axis === 'vertical' ? KeyIntent.MoveNextItem : null;
			case 'left':
				return axis === 'horizontal'
					? KeyIntent.MovePreviousItem
					: ctx.navigationNode.enableChildNavigationAcrossContainers
					? KeyIntent.MoveToPreviousContainer
					: null;
			case 'right':
				return axis === 'horizontal'
					? KeyIntent.MoveNextItem
					: ctx.navigationNode.enableChildNavigationAcrossContainers
					? KeyIntent.MoveToNextContainer
					: null;
			default:
				return null;
		}
	}

	switch (key.name) {
		case 'h':
			return KeyIntent.ToggleHelp;
		case 'up':
			return axis === 'vertical' ? KeyIntent.NavPreviousItem : null;
		case 'down':
			return axis === 'vertical' ? KeyIntent.NavNextItem : null;
		case 'left':
			return axis === 'horizontal'
				? KeyIntent.NavPreviousItem
				: ctx.navigationNode.enableChildNavigationAcrossContainers
				? KeyIntent.NavToPreviousContainer
				: null;
		case 'right':
			return axis === 'horizontal'
				? KeyIntent.NavNextItem
				: ctx.navigationNode.enableChildNavigationAcrossContainers
				? KeyIntent.NavToNextContainer
				: null;
		case 'return':
			return KeyIntent.Confirm;
		case 'e':
			return KeyIntent.Exit;
		default:
			return null;
	}
}
