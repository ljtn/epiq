import {beforeEach, describe, expect, it, vi} from 'vitest';
import {failed, succeeded} from '../lib/model/result-types.js';
import {emailLinkKey} from '../lib/model/email-link.js';

/**
 * Where the command line goes after a setup answer lands.
 *
 * Setup is four commands, and its whole shape is that answering one opens the
 * next already typed. That broke once because the commands closed the line
 * themselves before the hook that chains them ran, so every step had to be
 * typed out again. The hook owns the mode now, and these hold it to that.
 */

// Setup writes to disk and asks the repository whether a board exists yet.
// Neither is what is under test here.
let projectExists = true;

vi.mock('../lib/config/user-config.js', () => ({
	setConfig: vi.fn(() => succeeded('Wrote', null)),
	readEpiqConfig: vi.fn(() =>
		succeeded('Read', {
			userId: 'USER',
			userName: null,
			preferredEditor: '',
		}),
	),
}));

vi.mock('../lib/project-setup/project-setup.js', async importOriginal => ({
	...(await importOriginal<
		typeof import('../lib/project-setup/project-setup.js')
	>()),
	readProjectFile: vi.fn(() =>
		projectExists
			? succeeded('Read', {})
			: failed('Missing .epiq/project.json'),
	),
}));

vi.mock('../lib/storage/paths.js', async importOriginal => ({
	...(await importOriginal<typeof import('../lib/storage/paths.js')>()),
	resolveClosestEpiqProjectRoot: vi.fn(() =>
		succeeded('Resolved', process.cwd()),
	),
}));

const {onConfirmCommandLineSequenceInput} = await import(
	'../lib/actions/input/on-cmd-input-confirm.js'
);
const {advanceSetup} = await import('../lib/command-line/setup-flow.js');
const {configCommand} = await import(
	'../lib/command-line/commands/config.cmd.js'
);
const {Mode} = await import('../lib/model/action-map.model.js');
const {getCmdState, replaceCmdInput} = await import(
	'../lib/state/cmd.state.js'
);
const {patchSettingsState} = await import('../lib/state/settings.state.js');
const {getState, initWorkspaceState, patchState} = await import(
	'../lib/state/state.js'
);
const {nodes} = await import('../lib/state/node-builder.js');

const WORKSPACE = '01J000000000000000000WSPC';

/** Types a whole line and presses enter on it. */
const answer = async (line: string) => {
	patchState({mode: Mode.COMMAND_LINE});
	replaceCmdInput(line);

	return onConfirmCommandLineSequenceInput();
};

/** What is waiting in the command line afterwards. */
const line = () => getCmdState().value;

beforeEach(() => {
	projectExists = true;
	initWorkspaceState(nodes.workspace(WORKSPACE, 'Test Root', 'a'));
	replaceCmdInput('');
	patchState({mode: Mode.DEFAULT, readOnly: false});
	patchSettingsState({
		userName: null,
		userId: null,
		preferredEditor: null,
		autoSync: null,
		declinedEmailBoards: [],
		gitEmail: 'jola@example.com',
		gitName: 'Jonatan Lampa',
	});
});

describe('answering a step opens the next one', () => {
	it('opens the editor step after the username', async () => {
		await answer('config username Jonatan');

		expect(line()).toBe('config editor ');
		expect(getState().mode).toBe(Mode.COMMAND_LINE);
	});

	it('opens the auto sync step after the editor', async () => {
		patchSettingsState({userName: 'Jonatan', userId: 'USER'});

		await answer('config editor vim');

		expect(line()).toBe('config autoSync ');
	});

	it('opens the claiming step after auto sync, seeded with the git address', async () => {
		patchSettingsState({
			userName: 'Jonatan',
			userId: 'USER',
			preferredEditor: 'vim',
		});

		await answer('config autoSync off');

		expect(line()).toBe('config emails jola@example.com');
	});

	it('asks for a board first when there is none', async () => {
		projectExists = false;
		patchSettingsState({
			userName: 'Jonatan',
			userId: 'USER',
			preferredEditor: 'vim',
		});

		await answer('config autoSync off');

		expect(line()).toBe('init');
	});
});

describe('once setup is done', () => {
	beforeEach(() => {
		patchSettingsState({
			userName: 'Jonatan',
			userId: 'USER',
			preferredEditor: 'vim',
			autoSync: false,
		});

		// The claiming step is answered by the board, not by a flag — so this is
		// what "answered" looks like, whether it was the GUI or `:config emails`
		// that wrote it.
		patchState({
			emailLinks: {
				[emailLinkKey('jola@example.com', 'USER')]: {
					email: 'jola@example.com',
					contributor: 'USER',
					authorId: 'USER',
				},
			},
		});
	});

	it('closes the line like any other command', async () => {
		await answer('config editor nano');

		expect(line()).toBe('');
		expect(getState().mode).toBe(Mode.DEFAULT);
	});
});

describe('the commands leave the mode to the hook', () => {
	// The regression: each case closed the line itself, so by the time the hook
	// ran the mode was no longer the command line and it left well alone.
	it('stays in the command line after a config command', () => {
		patchState({mode: Mode.COMMAND_LINE});

		configCommand({
			command: 'config',
			modifier: 'editor',
			inputString: 'vim',
		});

		expect(getState().mode).toBe(Mode.COMMAND_LINE);
	});

	// `:init` rebuilds the whole workspace state, mode included, so after it the
	// mode is the board's. That is a reset, not a destination, and the sequence
	// has a step left to ask for.
	it('carries on when the answer rebuilt the state under it', () => {
		patchSettingsState({
			userName: 'Jonatan',
			userId: 'USER',
			preferredEditor: 'vim',
			autoSync: false,
		});
		patchState({mode: Mode.DEFAULT});

		advanceSetup();

		expect(line()).toBe('config emails jola@example.com');
		expect(getState().mode).toBe(Mode.COMMAND_LINE);
	});

	it('leaves a screen a command opened alone', () => {
		patchState({mode: Mode.IDENTITY});
		replaceCmdInput('config emails');

		advanceSetup();

		expect(getState().mode).toBe(Mode.IDENTITY);
		expect(line()).toBe('config emails');
	});
});
