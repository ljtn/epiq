import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	getCommitsForRef,
	getCommitsForRefs,
	getCommitTimeline,
	resetCommitTimelineCacheForTests,
} from '../lib/commits/commits.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {makeTempDir} from './helpers/git-repo.js';
import {
	collectRefDiffTimeline,
	getRefDiffTimeline,
} from '../mcp/api/ref-diff-stats.js';

// Real git log output from the board's own repo, read the way every source is.

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const commit = (cwd: string, author: string, message: string[]) =>
	childProcess.execFileSync(
		'git',
		['commit', '-q', '--allow-empty', ...message.flatMap(part => ['-m', part])],
		{
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: author,
				GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@example.com`,
				GIT_COMMITTER_NAME: author,
				GIT_COMMITTER_EMAIL: `${author.toLowerCase()}@example.com`,
			},
		},
	);

let board: string;

beforeEach(() => {
	resetCommitTimelineCacheForTests();

	board = makeTempDir();
	childProcess.execFileSync('git', ['init', '-q', '-b', 'main'], {cwd: board});
	fs.mkdirSync(path.join(board, '.epiq'), {recursive: true});
	fs.writeFileSync(
		path.join(board, '.epiq', 'project.json'),
		JSON.stringify({
			projectId: path.basename(board),
			stateBranch: 'epiq/state',
			createdAt: '2020-01-01T00:00:00.000Z',
		}) + '\n',
	);
	commit(board, 'Ada', ['init']);
	childProcess.execFileSync('git', ['branch', 'epiq/state'], {cwd: board});
});

afterEach(() => {
	resetCommitTimelineCacheForTests();
});

describe("the board's own repo", () => {
	// A field opening with the letter a marker is spelled with must not be
	// taken for one: an author "Erik", a subject starting "B" or "E".
	it('reads fields that start like a marker, and the refs in bodies', async () => {
		commit(board, 'Erik', ['pin the tag', 'Epiq-Ref: B8PYTCM']);
		commit(board, 'Ada', ['Bump the floor', 'Epiq-Ref: W1TCS14, B8PYTCM']);
		commit(board, 'Bea', ['Enable the timer']);

		const timeline = value(await getCommitTimeline({repoRoot: board}));

		expect(
			timeline.map(({author, subject, refs}) => ({author, subject, refs})),
		).toEqual([
			{author: 'Bea', subject: 'Enable the timer', refs: undefined},
			{
				author: 'Ada',
				subject: 'Bump the floor',
				refs: ['W1TCS14', 'B8PYTCM'],
			},
			{author: 'Erik', subject: 'pin the tag', refs: ['B8PYTCM']},
		]);

		const linked = value(
			await getCommitsForRef({repoRoot: board, ref: 'B8PYTCM'}),
		);
		expect(linked.map(entry => entry.subject)).toEqual([
			'Bump the floor',
			'pin the tag',
		]);
	});

	it('still links a commit by a ref-prefixed subject', async () => {
		commit(board, 'Erik', ['B8PYTCM pin the tag']);

		const linked = value(
			await getCommitsForRef({repoRoot: board, ref: 'B8PYTCM'}),
		);
		expect(linked.map(entry => entry.author)).toEqual(['Erik']);
	});

	// A goal's list: one commit naming two of its tickets is one row.
	it("lists several tickets' commits once each, naming the tickets", async () => {
		commit(board, 'Erik', ['B8PYTCM pin the tag']);
		commit(board, 'Ada', ['W1TCS14 bump the floor', 'Epiq-Ref: B8PYTCM']);
		commit(board, 'Bea', ['QQQQQQQ elsewhere']);

		const listed = async (refs: string[]) =>
			value(await getCommitsForRefs({repoRoot: board, refs})).map(
				({subject, tickets}) => ({subject, tickets: [...tickets].sort()}),
			);

		// One second apart at most, so the order is the tiebreak's: the same
		// either way round.
		const forward = await listed(['B8PYTCM', 'W1TCS14']);
		expect(await listed(['W1TCS14', 'B8PYTCM'])).toEqual(forward);
		expect(
			[...forward].sort((a, b) => a.subject.localeCompare(b.subject)),
		).toEqual([
			{subject: 'B8PYTCM pin the tag', tickets: ['B8PYTCM']},
			{subject: 'W1TCS14 bump the floor', tickets: ['B8PYTCM', 'W1TCS14']},
		]);
	});

	// One pass over the history answers what a pass per ticket did.
	it("lists several tickets as the union of each one's list", async () => {
		commit(board, 'Ada', ['b8pytcm lowercase subject']);
		commit(board, 'Ada', ['B8PYTCM next to it']);
		commit(board, 'Bea', ['QQQQQQQ someone else']);
		commit(board, 'Erik', ['two at once', 'Epiq-Ref: W1TCS14, B8PYTCM']);
		commit(board, 'Erik', ['W1TCS14 after it']);
		commit(board, 'Erik', ['ZZZZZZZ no goal ticket']);

		const refs = ['B8PYTCM', 'W1TCS14'];
		const union = new Map<
			string,
			{sha: string; precedingSha: string | null; tickets: string[]}
		>();
		for (const ref of refs) {
			for (const entry of value(
				await getCommitsForRef({repoRoot: board, ref}),
			)) {
				const seen = union.get(entry.sha);
				union.set(entry.sha, {
					sha: entry.sha,
					precedingSha: seen?.precedingSha ?? entry.precedingSha,
					tickets: [...(seen?.tickets ?? []), ref].sort(),
				});
			}
		}

		const listed = value(await getCommitsForRefs({repoRoot: board, refs}));
		expect(listed).toHaveLength(4);
		// Adjacent commits of the goal chain; not every link is null.
		expect(listed.filter(entry => entry.precedingSha).length).toBe(2);
		expect(
			listed.map(({sha, precedingSha, tickets}) => ({
				sha,
				precedingSha,
				tickets,
			})),
		).toEqual(listed.map(({sha}) => union.get(sha)));
	});
});

// A goal's many refs read the full scan, a ticket's few git's search: the two
// paths must give one answer.
describe('a ref set past the search limit', () => {
	it('matches exactly what the search finds for the refs that exist', async () => {
		commit(board, 'Ada', ['B8PYTCM start the parser']);
		commit(board, 'Ada', ['b8pytcm keep going']);
		commit(board, 'Bea', ['unrelated work']);
		commit(board, 'Bea', ['wire it up', 'Epiq-Ref: W1TCS14, B8PYTCM']);
		commit(board, 'Erik', ['W1TCS14X looks like a ref but is not']);
		commit(board, 'Erik', ['W1TCS14 the last of it']);

		const real = ['B8PYTCM', 'W1TCS14'];
		// Well-formed refs that name no commit, enough to pass the limit.
		const absent = Array.from(
			{length: 15},
			(_, index) => `ZZZZZ${String(index).padStart(2, '0')}`,
		);

		const shape = (commits: Awaited<ReturnType<typeof getCommitsForRefs>>) =>
			value(commits).map(({sha, tickets, precedingSha}) => ({
				sha,
				tickets,
				precedingSha,
			}));

		resetCommitTimelineCacheForTests();
		const searched = shape(
			await getCommitsForRefs({repoRoot: board, refs: real}),
		);
		resetCommitTimelineCacheForTests();
		const scanned = shape(
			await getCommitsForRefs({repoRoot: board, refs: [...real, ...absent]}),
		);

		expect(searched).toHaveLength(4);
		expect(scanned).toEqual(searched);
	});
});

// The cards' totals diff only the commits naming a ticket; summed, they must
// equal what the full scan of every commit gives.
describe("tickets' diff totals", () => {
	const commitFile = (message: string[], file: string, lines: number) => {
		fs.writeFileSync(
			path.join(board, file),
			Array.from({length: lines}, (_, n) => `line ${n}\n`).join(''),
		);
		childProcess.execFileSync('git', ['add', file], {cwd: board});
		commit(board, 'Ada', message);
	};

	it('match the full scan, from only the commits that name a ticket', async () => {
		commitFile(['B8PYTCM start'], 'a.txt', 12);
		commitFile(['unrelated change'], 'b.txt', 40);
		commitFile(['wire it up', 'Epiq-Ref: W1TCS14, B8PYTCM'], 'a.txt', 5);
		commitFile(['w1tcs14 lower-case lead'], 'c.txt', 3);
		commitFile(['W1TCS14X not a ref'], 'd.txt', 9);

		resetCommitTimelineCacheForTests();
		const fromScan = collectRefDiffTimeline(
			value(await getCommitTimeline({repoRoot: board})),
		);
		resetCommitTimelineCacheForTests();
		const fromNamed = value(await getRefDiffTimeline({repoRoot: board}));

		expect(Object.keys(fromNamed).sort()).toEqual(['B8PYTCM', 'W1TCS14']);
		expect(fromNamed).toEqual(fromScan);
	});
});
