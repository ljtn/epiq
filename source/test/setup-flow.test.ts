import {beforeEach, describe, expect, it, vi} from 'vitest';
import {failed, succeeded} from '../lib/model/result-types.js';
import {emailLinkKey} from '../lib/model/email-link.js';

/** Where the command line goes after a setup answer: the next step, already typed. */

// Setup writes to disk and asks the repository whether a board exists yet.
// Neither is what is under test here.
let projectExists = true;
let inGitRepository = true;

vi.mock('../lib/config/user-config.js', () => ({
	setConfig: vi.fn(() => succeeded('Wrote', null)),
	readEpiqConfig: vi.fn(() =>
		succeeded('Read', {
			userId: 'USER',
			userName: null,
			preferredEditor: '',
		}),
	),
	// As the real one does with this config: no name, no actor.
	loadSettingsFromConfig: vi.fn(() => failed('User name not configured')),
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
	readProjectId: vi.fn(() =>
		projectExists
			? succeeded('Read', 'BOARD')
			: failed('Missing .epiq/project.json'),
	),
}));

vi.mock('../lib/storage/paths.js', async importOriginal => ({
	...(await importOriginal<typeof import('../lib/storage/paths.js')>()),
	resolveClosestEpiqProjectRoot: vi.fn(() =>
		succeeded('Resolved', process.cwd()),
	),
	isInsideGitRepository: vi.fn(() => inGitRepository),
}));

const {onConfirmCommandLineSequenceInput} = await import(
	'../lib/actions/input/on-cmd-input-confirm.js'
);
const {
	advanceSetup,
	leaveSetupRerun,
	noteSetupAnswer,
	openSetupRerunStep,
	startSetupRerun,
} = await import('../lib/command-line/setup-flow.js');
const {getSetupSession, resetSetupSession} = await import(
	'../lib/state/setup-session.state.js'
);
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
	// As the `config` command does, before its answer lands.
	if (line.startsWith('config')) noteSetupAnswer();

	return onConfirmCommandLineSequenceInput();
};

/** What is waiting in the command line afterwards. */
const line = () => getCmdState().value;

beforeEach(() => {
	projectExists = true;
	inGitRepository = true;
	resetSetupSession();
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
});

describe('once setup is done', () => {
	beforeEach(() => {
		patchSettingsState({
			userName: 'Jonatan',
			userId: 'USER',
			preferredEditor: 'vim',
			autoSync: false,
		});

		// The claiming step is answered by the board's links, whoever wrote them.
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

	// `:init` resets the mode; setup still has a step left to ask.
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

describe('finishing setup hands over', () => {
	beforeEach(() => {
		projectExists = false;
		patchSettingsState({
			userName: 'Jonatan',
			userId: 'USER',
			preferredEditor: 'vim',
		});
	});

	it('asks to start a project in a git repository with none, init typed', async () => {
		await answer('config autoSync off');

		expect(getSetupSession().justCompleted).toBe(true);
		expect(line()).toBe('init');
		expect(getState().mode).toBe(Mode.COMMAND_LINE);
	});

	it('types nothing outside a git repository; the screen says what is next', async () => {
		inGitRepository = false;

		await answer('config autoSync off');

		expect(getSetupSession().justCompleted).toBe(true);
		expect(line()).toBe('');
		expect(getState().mode).toBe(Mode.DEFAULT);
	});

	it('does not hand over again when a setting changes later', async () => {
		patchSettingsState({autoSync: false});

		await answer('config editor nano');

		expect(getSetupSession().justCompleted).toBeFalsy();
		expect(line()).toBe('');
	});
});

describe(':setup asks the machine questions again', () => {
	beforeEach(() => {
		patchSettingsState({
			userName: 'Jonatan',
			userId: 'USER',
			preferredEditor: 'vim',
			autoSync: false,
		});
		startSetupRerun();
		openSetupRerunStep();
	});

	it('opens each step holding its current answer', async () => {
		expect(line()).toBe('config username Jonatan');

		await answer('config username Jonatan');
		expect(line()).toBe('config editor vim');

		await answer('config editor nano');
		expect(line()).toBe('config autoSync off');
	});

	it('hands over after the last step', async () => {
		projectExists = false;
		await answer('config username Jonatan');
		await answer('config editor vim');
		await answer('config autoSync off');

		expect(getSetupSession().rerunStep).toBeUndefined();
		expect(getSetupSession().justCompleted).toBe(true);
		expect(line()).toBe('init');
	});

	it('ends on esc, keeping the answers given', async () => {
		await answer('config username Jo');
		leaveSetupRerun();

		expect(getSetupSession().rerunStep).toBeUndefined();
		expect(getSetupSession().inProgress).toBe(false);
	});
});
