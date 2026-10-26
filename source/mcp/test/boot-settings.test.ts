import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {isFail, Result, succeeded} from '../../lib/model/result-types.js';

/**
 * A boot that skips deriving an unchanged board still refreshes the configured
 * identity, since a `:config user` rename writes no event.
 */

vi.mock('../../git/git-storage.js', () => ({
	getStateBranchRoot: vi.fn(() =>
		succeeded('Resolved state branch root', '/state'),
	),
}));

vi.mock('../../git/git.js', () => ({
	ensureLocalStateBranch: vi.fn(() =>
		succeeded('Local state branch already exists', false),
	),
	ensureStateBranchWorktree: vi.fn(() =>
		succeeded('Ensured state branch worktree', undefined),
	),
}));

vi.mock('../../git/git-utils.js', () => ({
	execGit: vi.fn(() => succeeded('Ran git', '')),
	// A boot reads git user.email for the address to link. Non-zero, so this
	// repository has none and nothing is linked.
	execGitAllowFail: vi.fn(async () => ({stdout: '', stderr: '', exitCode: 1})),
}));

vi.mock('../../git/git-constants.js', () => ({
	getStateBranch: vi.fn(() => succeeded('Resolved state branch', 'epiq-state')),
	ORIGIN: 'origin',
}));

vi.mock('../../lib/storage/paths.js', async importOriginal => {
	const actual = await importOriginal<
		typeof import('../../lib/storage/paths.js')
	>();

	return {
		...actual,
		resolveClosestEpiqProjectRoot: vi.fn((dir: string) =>
			succeeded('Resolved closest epiq project root', dir),
		),
		getEpiqDirPath: vi.fn(() => '/state/.epiq'),
	};
});

vi.mock('../../lib/board/board-log.js', async importOriginal => ({
	...(await importOriginal<typeof import('../../lib/board/board-log.js')>()),
	loadMergedEventsWithUnreadable: vi.fn(() =>
		succeeded('loaded', {events: [], unreadable: []}),
	),
}));

vi.mock('../../lib/board/board-boot.js', () => ({
	bootStateFromEventLog: vi.fn(() => succeeded('booted', null)),
}));

// The board never moves, so every boot after the first meets the skip — which
// is the whole point of the case below.
vi.mock('../../lib/event/log-signature.js', () => {
	let accounted: string | null = null;

	return {
		logSignature: vi.fn(() => 'a-board-that-never-moves'),
		accountedSignature: vi.fn(() => accounted),
		accountFor: vi.fn((_root: string, signature: string) => {
			accounted = signature;
		}),
	};
});

// Booted, as far as the skip is concerned: the real one tracks a state
// singleton this file's mocked boot never fills.
vi.mock('../../lib/state/state.js', async importOriginal => {
	const actual = await importOriginal<
		typeof import('../../lib/state/state.js')
	>();

	return {...actual, isStateInitialized: vi.fn(() => true)};
});

vi.mock('../epiq-time-travel.js', () => ({
	getTimeTravelStatus: vi.fn(() => ({mode: 'live', asOfTime: null})),
}));

vi.mock('../../lib/config/user-config.js', () => ({
	loadSettingsFromConfig: vi.fn(),
}));

let boot: typeof import('../api/boot.js');
let userConfig: typeof import('../../lib/config/user-config.js');
let settings: typeof import('../../lib/state/settings.state.js');

beforeAll(async () => {
	boot = await import('../api/boot.js');
	userConfig = await import('../../lib/config/user-config.js');
	settings = await import('../../lib/state/settings.state.js');
});

const configured = (userName: string) =>
	succeeded('loaded settings', {userId: 'user-1', userName}) as Result<
		ReturnType<typeof settings.getSettingsState>
	>;

const sayConfigHolds = (userName: string) =>
	vi
		.mocked(userConfig.loadSettingsFromConfig)
		.mockReturnValue(
			configured(userName) as ReturnType<
				typeof userConfig.loadSettingsFromConfig
			>,
		);

describe('the settings store a boot fills', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('takes the identity from config on the first boot', async () => {
		sayConfigHolds('Alice');

		expect(isFail(await boot.boot('/repo', {pull: false}))).toBe(false);
		expect(settings.getSettingsState().userName).toBe('Alice');
	});

	// Renaming in config writes no event, so the next boot takes the skip.
	it('is refreshed on a boot that skips deriving the board', async () => {
		sayConfigHolds('Alice');
		expect(isFail(await boot.boot('/repo', {pull: false}))).toBe(false);

		sayConfigHolds('Alice Cooper');
		const second = await boot.boot('/repo', {pull: false});

		expect(second.message).toContain('unchanged');
		expect(settings.getSettingsState().userName).toBe('Alice Cooper');
	});
});
