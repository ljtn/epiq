import readline from 'readline';
import {Mode, ModeUnion} from '../model/action-map.model.js';
import {appState} from '../state/state.js';
import {getCommandLineIntent} from './get-command-line-intent.js';
import {commandLineState} from '../state/cmd.state.js';

export enum Intent {
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
	InitCommandLine = 'initCommandLine',
	ExitCommandLine = 'exitCommandLine',
	CaptureInput = 'captureInput',
	EraseInput = 'eraseInput',
	AddItem = 'addItem',
	GetLastCommandFromHistory = 'getLastCommandFromHistory',
	GetNextCommandFromHistory = 'getNextCommandFromHistory',
	AutoCompleteCommand = 'autoCompleteCommand',
	MoveCursorLeft = 'MoveCursorLeft',
	MoveCursorRight = 'MoveCursorRight',
	MoveCursorLeftOfWord = 'MoveCursorLeftOfWord',
	MoveCursorRightOfWord = 'MoveCursorRightOfWord',
	EraseInputWord = 'EraseInputWord',
	None = 'None',
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
	axis: 'vertical' | 'horizontal',
	dir: Dir,
	intents: {
		prevItem: Intent;
		nextItem: Intent;
		prevContainer: Intent;
		nextContainer: Intent;
	},
): Intent | null {
	const enableAcrossContainers =
		appState.currentNode.childNavigationAcrossParents;
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
	mode: ModeUnion,
): Intent | null {
	if (key.sequence === ':' && commandLineState.value === '')
		return Intent.InitCommandLine;
	if (mode === Mode.COMMAND_LINE)
		return getCommandLineIntent(key, commandLineState.value);

	// Navigation keys
	const dir = getDir(key);
	if (dir) {
		let dirMap =
			mode === Mode.MOVE
				? {
						prevItem: Intent.MovePreviousItem,
						nextItem: Intent.MoveNextItem,
						prevContainer: Intent.MoveToPreviousContainer,
						nextContainer: Intent.MoveToNextContainer,
				  }
				: {
						prevItem: Intent.NavPreviousItem,
						nextItem: Intent.NavNextItem,
						prevContainer: Intent.NavToPreviousContainer,
						nextContainer: Intent.NavToNextContainer,
				  };

		return mapDirectionalIntent(
			appState.currentNode.childRenderAxis,
			dir,
			dirMap,
		);
	}

	// Hard exit
	if (key.ctrl && key.name === 'c') return Intent.Exit;

	// Default actions
	switch (key.name) {
		case 'i':
			return Intent.Edit;
		case 'y':
			return Intent.InitMove;
		case 'e':
		case 'return':
			return Intent.Confirm;
		case 'q':
		case 'backspace':
			return Intent.Exit;
		case 'escape':
			return Intent.Exit;
		default:
			return null;
	}
}
