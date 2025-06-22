import readline from 'readline';
import {NavigateCtx} from '../navigation-context.js';

export enum KeyIntent {
	MovePreviousItem = 'move-previous-item',
	MoveNextItem = 'move-next-item',
	MoveToPreviousContainer = 'move-to-previous-container',
	MoveToNextContainer = 'move-to-next-container',
	Confirm = 'confirm',
	Exit = 'exit',
	Move = 'move',
	ToggleHelp = 'toggle-help',
}

export function getKeyIntent(
	key: readline.Key,
	ctx: NavigateCtx,
): KeyIntent | null {
	const axis = ctx.navigationNode.childrenRenderAxis;

	switch (key.name) {
		case 'h':
			return KeyIntent.ToggleHelp;
		case 'm':
			return KeyIntent.Move;
		case 'up':
			return axis === 'vertical' ? KeyIntent.MovePreviousItem : null;
		case 'down':
			return axis === 'vertical' ? KeyIntent.MoveNextItem : null;
		case 'left':
			return axis === 'horizontal'
				? KeyIntent.MovePreviousItem
				: KeyIntent.MoveToPreviousContainer;
		case 'right':
			return axis === 'horizontal'
				? KeyIntent.MoveNextItem
				: KeyIntent.MoveToNextContainer;
		case 'return':
			return KeyIntent.Confirm;
		case 'e':
			return KeyIntent.Exit;
		default:
			return null;
	}
}
