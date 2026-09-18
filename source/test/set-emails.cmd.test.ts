import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';
import {bootStateFromEventLog} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {emailsOf} from '../lib/model/email-link.js';
import {isFail, succeeded} from '../lib/model/result-types.js';
import {resetEmailScanCacheForTests} from '../lib/repository/email-candidates.js';
import {patchSettingsState} from '../lib/state/settings.state.js';
import {getState} from '../lib/state/state.js';

// The scan and the write are the two things this command does not own. Both are
// covered by their own tests; what is under test here is everything between the
// typed argument and the event.
vi.mock('../git/git-utils.js', () => ({execGitAllowFail: vi.fn()}));
vi.mock('../git/git-constants.js', () => ({
	getStateBranch: vi.fn(() => succeeded('Branch', '__epiq_state__')),
	ORIGIN: 'origin',
}));
vi.mock('../git/git-storage.js', () => ({
	getStateBranchRoot: vi.fn(() => succeeded('Root', '/state')),
}));
vi.mock('../lib/storage/paths.js', async importOriginal => ({
	...(await importOriginal<typeof import('../lib/storage/paths.js')>()),
	// The worktree itself: booting a board reads a real `.epiq/project.json`,
	// and every git call here is mocked, so nothing touches the repository.
	resolveClosestEpiqProjectRoot: vi.fn(() =>
		succeeded('Resolved', process.cwd()),
	),
}));
vi.mock('../lib/config/user-config.js', () => ({
	setConfig: vi.fn(() => succeeded('Wrote', null)),
}));
vi.mock('../lib/board/board-log.js', async importOriginal => ({
	...(await importOriginal<typeof import('../lib/board/board-log.js')>()),
	materializeAndPersistAll: vi.fn(),
}));
vi.mock('../lib/state/cmd.state.js', () => ({
	getCmdState: vi.fn(),
	replaceCmdInput: vi.fn(),
}));

const {execGitAllowFail} = await import('../git/git-utils.js');
const {setConfig} = await import('../lib/config/user-config.js');
const {materializeAndPersistAll} = await import('../lib/board/board-log.js');
const {getCmdState} = await import('../lib/state/cmd.state.js');
const {setEmailsCommand} = await import(
	'../lib/command-line/commands/set-emails.cmd.js'
);

const FIELD = '\x1f';
const ALICE = '01J00000000000000000ALICE';
const WORKSPACE = '01J000000000000000000WSPC';

let seq = 0;
const event = <A extends AppEvent['action']>(
	action: A,
	payload: Extract<AppEvent, {action: A}>['payload'],
): AppEvent =>
	({
		id: ulid(1_700_000_000_000 + seq++),
		action,
		payload,
		userId: ALICE,
	} as AppEvent);

const board = (extra: AppEvent[] = []) => {
	const result = bootStateFromEventLog([
		event('init.workspace', {id: WORKSPACE, name: 'W', rank: 'a0'}),
		event('create.contributor', {id: ALICE, name: 'jola'}),
		...extra,
	]);
	if (isFail(result)) throw new Error(result.message);
};

const history = (rows: [string, string][]) =>
	vi.mocked(execGitAllowFail).mockResolvedValue({
		stdout: rows.map(([name, email]) => `${name}${FIELD}${email}`).join('\n'),
		stderr: '',
		exitCode: 0,
	} as never);

const typed = (value: string) =>
	vi.mocked(getCmdState).mockReturnValue({
		commandMeta: {inputString: value},
	} as never);

const written = () =>
	vi.mocked(materializeAndPersistAll).mock.calls.flatMap(call => call[0]);

describe(':config emails', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetEmailScanCacheForTests();
		vi.mocked(materializeAndPersistAll).mockReturnValue(
			succeeded('Wrote', []) as never,
		);
		patchSettingsState({
			userId: ALICE,
			userName: 'jola',
			gitEmail: 'jola@example.com',
			emailSetup: null,
		});
		board();
		history([
			['Jonatan Lampa', 'jola@example.com'],
			['J. Lampa', 'j.lampa@oldjob.com'],
			['Sam Rivers', 'sam@example.com'],
		]);
	});

	describe('picking', () => {
		it('claims the address given', async () => {
			typed('jola@example.com');
			const result = await setEmailsCommand();

			expect(isFail(result)).toBe(false);
			expect(written()).toHaveLength(1);
			expect(written()[0]).toMatchObject({
				action: 'link.contributor.email',
				payload: {contributor: ALICE, email: 'jola@example.com'},
			});
		});

		it('claims several, separated by commas or spaces', async () => {
			typed('jola@example.com, sam@example.com');
			await setEmailsCommand();

			expect(
				written().map(one => (one.payload as {email: string}).email),
			).toEqual(['jola@example.com', 'sam@example.com']);
		});

		// The completion offers addresses, so taking one has to work: a suggestion
		// that is then refused is a trap.
		it('claims by address, not only by number', async () => {
			typed('j.lampa@oldjob.com');
			await setEmailsCommand();

			expect(written()[0]).toMatchObject({
				payload: {email: 'j.lampa@oldjob.com'},
			});
		});

		it('matches an address whatever case it is typed in', async () => {
			typed('J.Lampa@OldJob.com');
			await setEmailsCommand();

			expect(written()[0]).toMatchObject({
				payload: {email: 'j.lampa@oldjob.com'},
			});
		});

		it('claims a repeated address once', async () => {
			typed('jola@example.com jola@example.com');
			await setEmailsCommand();

			expect(
				written().map(one => (one.payload as {email: string}).email),
			).toEqual(['jola@example.com']);
		});

		// Indices were offered once and are gone: every other command here takes
		// a value, and a list position is not one.
		it('refuses a number, which names nothing', async () => {
			typed('1');
			const result = await setEmailsCommand();

			expect(isFail(result)).toBe(true);
			expect(written()).toEqual([]);
		});

		it('records that the question was answered, so the step stops asking', async () => {
			typed('jola@example.com');
			await setEmailsCommand();

			expect(setConfig).toHaveBeenCalledWith({emailSetup: 'linked'});
		});
	});

	describe('declining', () => {
		it('records the decline and writes nothing', async () => {
			typed('none');
			const result = await setEmailsCommand();

			expect(isFail(result)).toBe(false);
			expect(setConfig).toHaveBeenCalledWith({emailSetup: 'declined'});
			expect(written()).toEqual([]);
		});

		// Saying no is the answer somebody gives precisely when the rest of this
		// is not working for them, so it must not depend on any of it.
		it('works with no board loaded', async () => {
			const result = bootStateFromEventLog([]);
			void result;
			typed('none');

			expect(isFail(await setEmailsCommand())).toBe(false);
			expect(setConfig).toHaveBeenCalledWith({emailSetup: 'declined'});
		});

		it('works when git cannot read the history', async () => {
			vi.mocked(execGitAllowFail).mockResolvedValue({
				stdout: '',
				stderr: 'not a repository',
				exitCode: 128,
			} as never);
			typed('none');

			expect(isFail(await setEmailsCommand())).toBe(false);
		});
	});

	describe('refusing', () => {
		it('an address nothing in the history carries', async () => {
			typed('nobody@example.com');
			const result = await setEmailsCommand();

			expect(isFail(result)).toBe(true);
			expect(isFail(result) && result.message).toContain('Not on the list');
			expect(written()).toEqual([]);
		});

		it('an address that is not on offer', async () => {
			typed('stranger@example.com');
			const result = await setEmailsCommand();

			expect(isFail(result)).toBe(true);
			expect(isFail(result) && result.message).toContain('Not on the list');
			expect(written()).toEqual([]);
		});

		it('a word that is neither', async () => {
			typed('banana');

			expect(isFail(await setEmailsCommand())).toBe(true);
			expect(written()).toEqual([]);
		});

		// Bare is not a refusal: it opens the screen that draws the list, because
		// a successful command's message is discarded and so cannot be the list.
		it('nothing at all, which opens the list instead of claiming', async () => {
			typed('');
			const result = await setEmailsCommand();

			expect(isFail(result)).toBe(false);
			expect(written()).toEqual([]);
		});

		it('a history git cannot read, rather than claiming nothing quietly', async () => {
			vi.mocked(execGitAllowFail).mockResolvedValue({
				stdout: '',
				stderr: 'not a repository',
				exitCode: 128,
			} as never);
			typed('1');
			const result = await setEmailsCommand();

			expect(isFail(result)).toBe(true);
			expect(isFail(result) && result.message).toContain('not a repository');
		});
	});

	describe('what it offers', () => {
		// The numbers a person reads off the screen have to be the numbers this
		// command counts, so both sides drop claimed addresses the same way.
		it('refuses an address somebody already claims', async () => {
			board([
				event('link.contributor.email', {
					contributor: ALICE,
					email: 'jola@example.com',
				}),
			]);
			typed('jola@example.com');
			const result = await setEmailsCommand();

			expect(isFail(result)).toBe(true);
			expect(written()).toEqual([]);
		});

		it('marks the answer given even when the history has nothing left', async () => {
			history([]);
			typed('');
			await setEmailsCommand();

			expect(setConfig).toHaveBeenCalledWith({emailSetup: 'linked'});
		});
	});

	// `:init` commits `.epiq/project.json`, so by the time this step runs the
	// user's own address is in the history whatever else the repository holds.
	it('offers the address the init commit was signed with in a fresh repository', async () => {
		history([['Jonatan Lampa', 'jola@example.com']]);
		typed('jola@example.com');
		await setEmailsCommand();

		expect(written()[0]).toMatchObject({
			payload: {email: 'jola@example.com'},
		});
		expect(emailsOf(getState().emailLinks, ALICE)).toEqual([]);
	});
});
