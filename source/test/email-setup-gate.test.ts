import {beforeEach, describe, expect, it, vi} from 'vitest';
import {failed, succeeded} from '../lib/model/result-types.js';
import {emailLinkKey} from '../lib/model/email-link.js';

/**
 * Whether the setup step still has a question to ask about git addresses.
 *
 * It used to ask a machine-global config flag that only `:config emails` ever
 * wrote. Claiming an address in the GUI's identity panel writes the same
 * `link.contributor.email` event and never touched that flag, so the step went
 * on asking on a board where it had already been answered — and since the
 * offered list keeps only *unclaimed* addresses, a repository holding
 * colleagues' addresses could never empty it either.
 *
 * So the claim is read from the board and only the refusal is kept locally,
 * per board. These hold it to that.
 */

let projectId: string | null = 'BOARD-ONE';

vi.mock('../lib/project-setup/project-setup.js', async importOriginal => ({
	...(await importOriginal<
		typeof import('../lib/project-setup/project-setup.js')
	>()),
	readProjectFile: vi.fn(() =>
		projectId
			? succeeded('Read', {projectId})
			: failed('Missing .epiq/project.json'),
	),
	readProjectId: vi.fn(() =>
		projectId ? succeeded('Read', projectId) : failed('No project'),
	),
}));

vi.mock('../lib/storage/paths.js', async importOriginal => ({
	...(await importOriginal<typeof import('../lib/storage/paths.js')>()),
	resolveClosestEpiqProjectRoot: vi.fn(() =>
		succeeded('Resolved', process.cwd()),
	),
}));

const {getUserSetupStatus} = await import('../lib/config/setup-utils.js');
const {patchSettingsState} = await import('../lib/state/settings.state.js');
const {initWorkspaceState, patchState} = await import('../lib/state/state.js');
const {nodes} = await import('../lib/state/node-builder.js');

const WORKSPACE = '01H00000000000000000000000';
const ME = 'USER-ME';
const SOMEBODY_ELSE = 'USER-THEM';

const claim = (email: string, contributor: string, tombstoned = false) => ({
	[emailLinkKey(email, contributor)]: {
		email,
		contributor,
		authorId: contributor,
		...(tombstoned ? {tombstoned: true} : {}),
	},
});

beforeEach(() => {
	projectId = 'BOARD-ONE';
	initWorkspaceState(nodes.workspace(WORKSPACE, 'Test Root', 'a'));
	patchState({emailLinks: {}});
	patchSettingsState({
		userName: 'Jonatan',
		userId: ME,
		preferredEditor: 'vim',
		autoSync: false,
		declinedEmailBoards: [],
	});
});

describe('the claiming step', () => {
	it('is still asking when nothing is claimed and nothing declined', () => {
		expect(getUserSetupStatus().isSetEmails).toBe(false);
	});

	// The bug, as reported: claimed in the GUI, still asked in the TUI.
	it('is answered by a claim on the board, whoever wrote it', () => {
		patchState({emailLinks: claim('jola@example.com', ME)});

		expect(getUserSetupStatus().isSetEmails).toBe(true);
	});

	it('reports which addresses answered it', () => {
		patchState({emailLinks: claim('jola@example.com', ME)});

		expect(getUserSetupStatus().claimedEmails).toEqual(['jola@example.com']);
	});

	it('is not answered by somebody else claiming an address', () => {
		patchState({emailLinks: claim('ralph@mayer.rocks', SOMEBODY_ELSE)});

		expect(getUserSetupStatus().isSetEmails).toBe(false);
	});

	// Unlinking is a decision too, and it puts the question back.
	it('is asking again once the only claim is retracted', () => {
		patchState({emailLinks: claim('jola@example.com', ME, true)});

		expect(getUserSetupStatus().isSetEmails).toBe(false);
	});

	it('is not asked at all before there is a board', () => {
		projectId = null;

		expect(getUserSetupStatus().isSetEmails).toBe(true);
	});
});

describe('declining', () => {
	it('answers the board it was declined on', () => {
		patchSettingsState({declinedEmailBoards: ['BOARD-ONE']});

		expect(getUserSetupStatus().isSetEmails).toBe(true);
	});

	// The reason the refusal is a list rather than one flag: the addresses
	// offered are a repository's own history, so declining one says nothing
	// about the next.
	it('says nothing about another board', () => {
		patchSettingsState({declinedEmailBoards: ['BOARD-ONE']});
		projectId = 'BOARD-TWO';

		expect(getUserSetupStatus().isSetEmails).toBe(false);
	});

	it('leaves the boards already declined alone when another is added', () => {
		patchSettingsState({declinedEmailBoards: ['BOARD-ONE', 'BOARD-TWO']});
		projectId = 'BOARD-TWO';

		expect(getUserSetupStatus().isSetEmails).toBe(true);
	});
});

describe('the whole setup', () => {
	it('is not done while the claiming step is unanswered', () => {
		expect(getUserSetupStatus().isSetupDone).toBe(false);
	});

	it('is done once the board carries a claim', () => {
		patchState({emailLinks: claim('jola@example.com', ME)});

		expect(getUserSetupStatus().isSetupDone).toBe(true);
	});
});

describe('the addresses the setup screen shows', () => {
	// Every other step's value is a word. This one is addresses, and an address
	// runs to 254 characters — unbounded the row wraps out of the bordered box
	// the setup screen draws it in, which is what a too-wide row always does.
	it('never outruns the room the row leaves it', async () => {
		const {claimedAddresses} = await import('../lib/components/SettingsUI.js');
		const long = `${'a'.repeat(200)}@example.com`;

		for (const width of [40, 80, 120, 200]) {
			const budget = Math.max(12, width - 34);
			const shown = claimedAddresses([long, long], width) ?? '';

			expect({width, within: shown.length <= budget}).toEqual({
				width,
				within: true,
			});
		}
	});

	it('shows nothing at all when nothing is claimed', async () => {
		const {claimedAddresses} = await import('../lib/components/SettingsUI.js');

		expect(claimedAddresses([], 120)).toBeUndefined();
	});

	it('shows both addresses whole when they fit', async () => {
		const {claimedAddresses} = await import('../lib/components/SettingsUI.js');

		expect(claimedAddresses(['a@b.com', 'c@d.com'], 120)).toBe(
			'a@b.com, c@d.com',
		);
	});
});
