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
	ViewHelp = 'viewHelp',
	HideHelp = 'hideHelp',
	InitMove = 'initMove',

	// Command line
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
	ctx: NavigateCtx,
	dir: Dir,
	intents: {
		prevItem: KeyIntent;
		nextItem: KeyIntent;
		prevContainer: KeyIntent;
		nextContainer: KeyIntent;
	},
): KeyIntent | null {
	const axis = ctx.navigationNode.childrenRenderAxis;
	const enableAcrossContainers =
		ctx.navigationNode.enableChildNavigationAcrossContainers;
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
	if (key.sequence === ':') return KeyIntent.ToggleCommandLine;
	if (mode === Mode.COMMAND_LINE) return getCommandLineIntent(key);

	// Navigation keys
	const dir = getDir(key);
	if (dir) {
		let dirMap =
			mode === Mode.MOVE
				? {
						prevItem: KeyIntent.MovePreviousItem,
						nextItem: KeyIntent.MoveNextItem,
						prevContainer: KeyIntent.MoveToPreviousContainer,
						nextContainer: KeyIntent.MoveToNextContainer,
				  }
				: {
						prevItem: KeyIntent.NavPreviousItem,
						nextItem: KeyIntent.NavNextItem,
						prevContainer: KeyIntent.NavToPreviousContainer,
						nextContainer: KeyIntent.NavToNextContainer,
				  };

		return mapDirectionalIntent(ctx, dir, dirMap);
	}

	// Hard exit
	if (key.ctrl && key.name === 'c') return KeyIntent.Exit;

	// Default actions
	switch (key.name) {
		case 'i':
			return KeyIntent.Edit;
		case 'y':
			return KeyIntent.InitMove;
		case 'return':
			return KeyIntent.Confirm;
		case 'q':
		case 'escape':
			return KeyIntent.Exit;
		default:
			return null;
	}
}
