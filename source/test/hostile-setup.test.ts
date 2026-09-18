import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';
import {bootStateFromEventLog} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {isFail, succeeded} from '../lib/model/result-types.js';
import {resetEmailScanCacheForTests} from '../lib/repository/email-candidates.js';
import {patchSettingsState} from '../lib/state/settings.state.js';

/**
 * Setup is the one flow that takes a repository's git history and a person's
 * typing and turns them into events every clone will hold forever. Both inputs
 * are hostile by default: a history is written by whoever cloned the
 * repository, and an answer is whatever was pasted into a terminal.
 *
 * Every case here asserts one of two things. Either nothing is written, or what
 * is written is an address the history actually holds. Nothing may crash: a
 * setup step that throws is a machine that cannot be set up at all.
 */

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
	resolveClosestEpiqProjectRoot: vi.fn(() =>
		succeeded('Resolved', process.cwd()),
	),
}));
vi.mock('../lib/config/user-config.js', () => ({
	setConfig: vi.fn(() => succeeded('Wrote', null)),
	readEpiqConfig: vi.fn(() =>
		succeeded('Read', {userId: 'USER', userName: 'jola', preferredEditor: ''}),
	),
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
const {materializeAndPersistAll} = await import('../lib/board/board-log.js');
const {getCmdState} = await import('../lib/state/cmd.state.js');
const {setEmailsCommand} = await import(
	'../lib/command-line/commands/set-emails.cmd.js'
);
const {unclaimEmailCommand} = await import(
	'../lib/command-line/commands/unclaim-email.cmd.js'
);
const {findEmailCandidates} = await import(
	'../lib/repository/email-candidates.js'
);
const {nextSetupCommand} = await import('../lib/config/setup-utils.js');
const {setOfferedEmails} = await import('../lib/state/email-offers.state.js');

const FIELD = '\x1f';
const NUL = '\x00';
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

/** Raw `git log` output, one line per commit, exactly as the scan reads it. */
const rawHistory = (lines: string[]) =>
	vi.mocked(execGitAllowFail).mockResolvedValue({
		stdout: lines.join('\n'),
		stderr: '',
		exitCode: 0,
	} as never);

const history = (rows: [string, string][]) =>
	rawHistory(rows.map(([name, email]) => `${name}${FIELD}${email}`));

const typed = (value: string) =>
	vi.mocked(getCmdState).mockReturnValue({
		commandMeta: {inputString: value},
	} as never);

const written = () =>
	vi.mocked(materializeAndPersistAll).mock.calls.flatMap(call => call[0]);

const scan = async () =>
	findEmailCandidates({repoRoot: '/repo', names: ['jola'], links: {}});

beforeEach(() => {
	vi.clearAllMocks();
	resetEmailScanCacheForTests();
	setOfferedEmails([]);
	vi.mocked(materializeAndPersistAll).mockReturnValue(
		succeeded('Wrote', []) as never,
	);
	patchSettingsState({
		userId: ALICE,
		userName: 'jola',
		gitEmail: 'jola@example.com',
		gitName: 'Jonatan Lampa',
		preferredEditor: 'vim',
		autoSync: false,
		emailSetup: null,
	});
	board();
	history([['Jonatan Lampa', 'jola@example.com']]);
});

describe('a history written by somebody else', () => {
	// Git accepts a control character inside an author name, so a commit can be
	// authored under a name that contains the scan's own field separator.
	// Splitting on the first one read the name's tail as the address.
	it('cannot forge an address by putting the separator in the name', async () => {
		rawHistory([`evil${FIELD}fake@attacker.com${FIELD}real@victim.com`]);

		const found = await scan();
		if (isFail(found)) throw new Error(found.message);

		expect(found.value.map(candidate => candidate.email)).toEqual([
			'real@victim.com',
		]);
		expect(found.value[0]?.names).toEqual([`evil${FIELD}fake@attacker.com`]);
	});

	it('drops a line with no separator at all', async () => {
		rawHistory(['just-some-text', `Sam${FIELD}sam@example.com`]);

		const found = await scan();
		if (isFail(found)) throw new Error(found.message);

		expect(found.value.map(candidate => candidate.email)).toEqual([
			'sam@example.com',
		]);
	});

	it('drops what is not address-shaped', async () => {
		rawHistory([
			`Sam${FIELD}not-an-address`,
			`Sam${FIELD}two@at@signs`,
			`Sam${FIELD}`,
			`Sam${FIELD}sam@example.com`,
		]);

		const found = await scan();
		if (isFail(found)) throw new Error(found.message);

		expect(found.value.map(candidate => candidate.email)).toEqual([
			'sam@example.com',
		]);
	});

	it('folds one address written several ways into one row', async () => {
		rawHistory([
			`Sam${FIELD}sam@example.com`,
			`Sam${FIELD}  SAM@Example.COM  `,
			`Samuel${FIELD}Sam@example.com`,
		]);

		const found = await scan();
		if (isFail(found)) throw new Error(found.message);

		expect(found.value).toHaveLength(1);
		expect(found.value[0]).toMatchObject({
			email: 'sam@example.com',
			commits: 3,
		});
	});

	it('survives a name nobody would type', async () => {
		rawHistory([`${'x'.repeat(200_000)}${FIELD}sam@example.com`]);

		const found = await scan();
		if (isFail(found)) throw new Error(found.message);

		expect(found.value.map(candidate => candidate.email)).toEqual([
			'sam@example.com',
		]);
	});
});

describe('an answer nobody would type', () => {
	const refused = async (answer: string) => {
		typed(answer);
		const result = await setEmailsCommand();

		expect(isFail(result)).toBe(true);
		expect(written()).toHaveLength(0);
	};

	it('refuses an address the history does not hold', () =>
		refused('me@elsewhere.com'));

	it('refuses an answer carrying a newline', () =>
		refused('jola@example.com\nsam@example.com'));

	it('refuses an answer carrying the scan separator', () =>
		refused(`jola@example.com${FIELD}evil@attacker.com`));

	it('refuses an answer carrying a null byte', () =>
		refused(`jola@example.com${NUL}evil@attacker.com`));

	it('refuses an answer of a hundred thousand characters', () =>
		refused('a'.repeat(100_000)));

	// `none` declines. Anything else is looked up, and nothing else is `none`.
	it('does not read NONE as declining', () => refused('NONE'));

	it('names what it would have accepted, so the answer is recoverable', async () => {
		typed('me@elsewhere.com');
		const result = await setEmailsCommand();

		expect(result.message).toContain('jola@example.com');
	});
});

describe('giving back an address', () => {
	const held = () =>
		board([
			event('link.contributor.email', {
				contributor: ALICE,
				email: 'jola@example.com',
			}),
		]);

	const refused = async (answer: string) => {
		held();
		typed(answer);
		const result = await unclaimEmailCommand();

		expect(isFail(result)).toBe(true);
		expect(written()).toHaveLength(0);
	};

	it('refuses an address held by nobody', () => refused('me@elsewhere.com'));

	it('refuses an answer carrying a newline', () =>
		refused('jola@example.com\nme@elsewhere.com'));

	it('refuses an answer of a hundred thousand characters', () =>
		refused('a'.repeat(100_000)));

	it('still takes the address itself, whatever case it is typed in', async () => {
		held();
		typed('  JOLA@Example.com  ');
		const result = await unclaimEmailCommand();

		expect(isFail(result)).toBe(false);
		expect(written()[0]).toMatchObject({
			action: 'unlink.contributor.email',
			payload: {email: 'jola@example.com'},
		});
	});
});

describe('the line setup types for you', () => {
	// The seeded claiming step is the one place a value reaches the command line
	// without a person putting it there, and it comes from git config, which is
	// whatever the machine says it is.
	const seeded = (gitEmail: string | null) => {
		patchSettingsState({gitEmail});
		return nextSetupCommand();
	};

	it('seeds a plausible address', () => {
		expect(seeded('jola@example.com')).toBe('config emails jola@example.com');
	});

	it('seeds nothing from an address carrying a newline', () => {
		expect(seeded('jola@example.com\nrm -rf /')).toBe('config emails ');
	});

	it('seeds nothing from an address that is not one', () => {
		expect(seeded('not an address')).toBe('config emails ');
	});

	it('seeds nothing from an address of a hundred thousand characters', () => {
		expect(seeded(`${'a'.repeat(100_000)}@example.com`)).toBe('config emails ');
	});

	it('seeds nothing when git has no address', () => {
		expect(seeded(null)).toBe('config emails ');
	});
});
