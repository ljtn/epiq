import readline from 'readline';
import {Mode, ModeUnion} from '../model/action-map.model.js';
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

	Confirm = 'confirm', // open / activate (Enter, e)
	Edit = 'edit', // vim-ish edit (i)
	Exit = 'exit',
	ToggleHelp = 'toggle-help',
	ToggleMove = 'toggle-move',
	ToggleCommandLine = 'toggle-command-line',
	CaptureInput = 'CaptureInput',
	EraseInput = 'EraseInput',
	AddItem = 'AddItem',
}

type Dir = 'up' | 'down' | 'left' | 'right';

function getDir(key: readline.Key): Dir | null {
	switch (key.name) {
		// arrows
		case 'up':
		case 'down':
		case 'left':
		case 'right':
			return key.name;

		// vim
		case 'k':
			return 'up';
		case 'j':
			return 'down';
		case 'h':
			return 'left';
		case 'l':
			return 'right';

		default:
			return null;
	}
}

function isHelpKey(key: readline.Key): boolean {
	// '?' like vim / less / man
	if (key.name === 'slash' && key.shift) return true;

	// Optional: Shift+H as secondary help
	if (key.name === 'h' && key.shift) return true;

	return false;
}

function mapDirectionalIntent(
	dir: Dir,
	axis: 'vertical' | 'horizontal',
	enableAcrossContainers: boolean,
	intents: {
		prevItem: KeyIntent;
		nextItem: KeyIntent;
		prevContainer: KeyIntent;
		nextContainer: KeyIntent;
	},
): KeyIntent | null {
	switch (dir) {
		case 'up':
			return axis === 'vertical' ? intents.prevItem : null;
		case 'down':
			return axis === 'vertical' ? intents.nextItem : null;
		case 'left':
			return axis === 'horizontal'
				? intents.prevItem
				: enableAcrossContainers
				? intents.prevContainer
				: null;
		case 'right':
			return axis === 'horizontal'
				? intents.nextItem
				: enableAcrossContainers
				? intents.nextContainer
				: null;
	}
}

export function getKeyIntent(
	key: readline.Key,
	ctx: NavigateCtx,
	mode: ModeUnion,
): KeyIntent | null {
	if (key.sequence === ':') {
		return KeyIntent.ToggleCommandLine;
	}
	if (mode === Mode.COMMAND_LINE) {
		switch (key.name) {
			case 'return':
				return KeyIntent.Confirm;
			case 'backspace':
				return KeyIntent.EraseInput;
			case 'escape':
				return KeyIntent.ToggleCommandLine;
			default:
				return KeyIntent.CaptureInput;
		}
	}

	const axis = ctx.navigationNode.childrenRenderAxis;
	const enableAcrossContainers =
		ctx.navigationNode.enableChildNavigationAcrossContainers;

	if (key.name === 'escape' && mode === Mode.HELP) {
		return KeyIntent.ToggleHelp;
	}

	// Hard exits
	if (key.ctrl && key.name === 'c') return KeyIntent.Exit;
	if (key.name === 'escape') return KeyIntent.Exit;

	// Move mode
	if (mode === Mode.MOVE) {
		if (key.name === 'y') return KeyIntent.ToggleMove;

		const dir = getDir(key);
		if (!dir) return null;

		return mapDirectionalIntent(dir, axis, Boolean(enableAcrossContainers), {
			prevItem: KeyIntent.MovePreviousItem,
			nextItem: KeyIntent.MoveNextItem,
			prevContainer: KeyIntent.MoveToPreviousContainer,
			nextContainer: KeyIntent.MoveToNextContainer,
		});
	}

	// Normal mode
	if (key.name === 'y') return KeyIntent.ToggleMove;
	if (isHelpKey(key)) return KeyIntent.ToggleHelp;

	// Edit (vim-ish)
	if (key.name === 'i') return KeyIntent.Edit;

	// Navigation (arrows + vim hjkl)
	const dir = getDir(key);
	if (dir) {
		return mapDirectionalIntent(dir, axis, Boolean(enableAcrossContainers), {
			prevItem: KeyIntent.NavPreviousItem,
			nextItem: KeyIntent.NavNextItem,
			prevContainer: KeyIntent.NavToPreviousContainer,
			nextContainer: KeyIntent.NavToNextContainer,
		});
	}

	// Actions
	switch (key.name) {
		case 'a':
			return KeyIntent.AddItem;
		case 'return':
		case 'e':
			return KeyIntent.Confirm;
		case 'q':
			return KeyIntent.Exit;
		default:
			return null;
	}
}
