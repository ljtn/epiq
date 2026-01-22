import readline from 'readline';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {NavigateCtx} from '../model/navigation-ctx.model.js';
import {getCommandLineIntent} from './get-command-line-intent.js';

export enum KeyIntent {
	NavPreviousItem = 'navPreviousItem',
	NavNextItem = 'navNextItem',
	NavToPreviousContainer = 'navToPreviousContainer',
	NavToNextContainer = 'navToNextContainer',

	MovePreviousItem = 'movePreviousItem',
	MoveNextItem = 'moveNextItem',
	MoveToPreviousContainer = 'moveToPreviousContainer',
	MoveToNextContainer = 'moveToNextContainer',

	Confirm = 'confirm',
	Edit = 'edit',
	Exit = 'exit',
	ToggleHelp = 'toggleHelp',
	ToggleMove = 'toggleMove',
	ToggleCommandLine = 'toggleCommandLine',
	CaptureInput = 'captureInput',
	EraseInput = 'eraseInput',
	AddItem = 'addItem',
	GetLastCommandFromHistory = 'getLastCommandFromHistory',
	GetNextCommandFromHistory = 'getNextCommandFromHistory',
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
			return axis === 'vertical'
				? intents.prevItem
				: enableAcrossContainers
				? intents.prevContainer
				: null;

		case 'down':
			return axis === 'vertical'
				? intents.nextItem
				: enableAcrossContainers
				? intents.nextContainer
				: null;

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
	if (mode.includes(Mode.COMMAND_LINE)) {
		return getCommandLineIntent(key);
	}

	const axis = ctx.navigationNode.childrenRenderAxis;
	const enableAcrossContainers =
		ctx.navigationNode.enableChildNavigationAcrossContainers;

	if (key.name === 'escape' && mode.includes(Mode.HELP)) {
		return KeyIntent.ToggleHelp;
	}

	// Hard exits
	if (key.ctrl && key.name === 'c') return KeyIntent.Exit;
	if (key.name === 'escape') return KeyIntent.Exit;

	// Move mode

	if (mode.includes(Mode.MOVE)) {
		if (key.name === 'y') return KeyIntent.ToggleMove;

		const dir = getDir(key);
		if (!dir) return null;

		const intent = mapDirectionalIntent(
			dir,
			axis,
			Boolean(enableAcrossContainers),
			{
				prevItem: KeyIntent.MovePreviousItem,
				nextItem: KeyIntent.MoveNextItem,
				prevContainer: KeyIntent.MoveToPreviousContainer,
				nextContainer: KeyIntent.MoveToNextContainer,
			},
		);
		return intent;
	}

	// Normal mode
	if (key.name === 'y') return KeyIntent.ToggleMove;

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
