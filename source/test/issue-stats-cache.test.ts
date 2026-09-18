import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';
import {bootStateFromEventLog} from '../lib/board/board-boot.js';
import {isFail, succeeded} from '../lib/model/result-types.js';

// Partial: the resolver is the only thing this test needs to steer, and listing
// the rest by hand meant adding an export every time something new in the graph
// asked paths a question.
vi.mock('../lib/storage/paths.js', async importOriginal => ({
	...(await importOriginal<typeof import('../lib/storage/paths.js')>()),
	// The worktree itself, because booting a board to give the resolver
	// something to resolve against reads a real `.epiq/project.json`. The git
	// and derivation calls are mocked, so nothing else touches the repository.
	resolveClosestEpiqProjectRoot: vi.fn(() =>
		succeeded('Resolved', process.cwd()),
	),
}));

vi.mock('../lib/commits/commits.js', () => ({
	getCommitsForRef: vi.fn(),
}));

vi.mock('../lib/stats/issue-stats.js', () => ({
	deriveIssueStats: vi.fn(),
}));

const {getCommitsForRef} = await import('../lib/commits/commits.js');
const {deriveIssueStats} = await import('../lib/stats/issue-stats.js');
const {getIssueStats, resetIssueStatsCacheForTests} = await import(
	'../mcp/epiq-issue-stats.js'
);

const derive = vi.mocked(deriveIssueStats);
const commits = vi.mocked(getCommitsForRef);

const REF = 'ABC1234';

const commitNamed = (sha: string) => ({
	sha,
	time: 1,
	author: 'jola',
	authorEmail: 'jola@example.com',
	subject: `${REF} one`,
	linesChanged: 1,
	insertions: 1,
	deletions: 0,
	precedingSha: null,
});

describe('getIssueStats caching', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetIssueStatsCacheForTests();

		commits.mockResolvedValue(succeeded('Matched', [commitNamed('commit-1')]));

		derive.mockImplementation(async ({ref}) =>
			succeeded('Derived', {ref} as never),
		);
	});

	it('answers a repeat ask from the cache', async () => {
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(1);
	});

	// The shas are the whole of what the answer depends on, so a new commit on
	// the ticket has to be a new key — nothing else here would notice.
	it('scans again when the ticket gains a commit', async () => {
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		commits.mockResolvedValue(
			succeeded('Matched', [commitNamed('commit-2'), commitNamed('commit-1')]),
		);

		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(2);
	});

	it('keeps one ticket answer out of another', async () => {
		await getIssueStats({idOrRef: REF, repoRoot: '/repo'});
		await getIssueStats({idOrRef: 'ZZZ9999', repoRoot: '/repo'});

		expect(derive).toHaveBeenCalledTimes(2);
	});
});

describe('the cache key and link state', () => {
	const WORKSPACE = '01J000000000000000000WSPC';
	const ALICE = '01J00000000000000000ALICE';

	let seq = 0;
	const event = (action: string, payload: unknown) =>
		({
			id: ulid(1_700_000_000_000 + seq++),
			action,
			payload,
			userId: ALICE,
		} as never);

	const board = (withLink: boolean) => {
		const log = [
			event('init.workspace', {id: WORKSPACE, name: 'W', rank: 'a0'}),
			event('create.contributor', {id: ALICE, name: 'claude/jola'}),
			...(withLink
				? [
						event('link.contributor.email', {
							contributor: ALICE,
							email: 'jola@example.com',
						}),
				  ]
				: []),
		];

		const result = bootStateFromEventLog(log);
		if (isFail(result)) throw new Error(result.message);
	};

	beforeEach(() => {
		resetIssueStatsCacheForTests();
		derive.mockReset();
		commits.mockReset();
		commits.mockResolvedValue(succeeded('Matched', [commitNamed('commit-1')]));
		derive.mockImplementation(async ({commits: given}) =>
			succeeded('Derived', {
				authors: given.map(one => one.author),
			} as never),
		);
	});

	// Linking an address changes who a commit belongs to without changing a
	// single sha. Keyed on shas alone, an entry made before the link kept
	// reporting the git name — and `change-shape` counts distinct authors off
	// that string, so one person went on reading as two.
	it('re-derives after a link changes who a commit resolves to', async () => {
		board(false);
		const before = await getIssueStats({idOrRef: REF});
		expect((before.value as unknown as {authors: string[]}).authors).toEqual([
			'jola',
		]);
		expect(derive).toHaveBeenCalledTimes(1);

		board(true);
		const after = await getIssueStats({idOrRef: REF});

		expect(derive).toHaveBeenCalledTimes(2);
		expect((after.value as unknown as {authors: string[]}).authors).toEqual([
			'claude/jola',
		]);
	});

	it('still serves the cache when nothing about the commits changed', async () => {
		board(true);

		await getIssueStats({idOrRef: REF});
		await getIssueStats({idOrRef: REF});

		expect(derive).toHaveBeenCalledTimes(1);
	});
});
