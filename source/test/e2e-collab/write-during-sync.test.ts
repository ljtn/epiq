/**
 * One machine, several tools, one of them writing while another syncs.
 *
 * `concurrent-sync.test.ts` races several syncs against each other, and the
 * sync lock settles those. Nothing holds that lock on the write path:
 * `persist` appends and `loadMergedEvents` reads with no lock at all, while a
 * sync in another process is rewriting the same directory — `git rebase`
 * replays commits over that worktree, and `rebase.autoStash` reverts the
 * working copy to HEAD and puts it back afterwards.
 *
 * A GUI beside an MCP server beside a TUI is the ordinary arrangement for an
 * agent-driven board, and only one of them has to be syncing for the others to
 * be writing into a directory git is part-way through rewriting.
 *
 * The contract under test is the narrowest one there is: an issue the board
 * accepted has to still exist afterwards, on every machine. Nothing about
 * ordering, nothing about ranks.
 */
import {afterEach, describe, expect, it} from 'vitest';
import {
	cleanUp,
	runActor,
	sameMachineTool,
	startCollaboration,
	type Actor,
	type Collaboration,
} from './harness.js';
import type {ActorReport} from './protocol.js';

const TIMEOUT_MS = 900_000;
const ROUNDS = 6;
// Enough commits that the rebase is still replaying when the writer starts.
const COMMITS_PER_ROUND = 8;
const WRITES_PER_ROUND = 20;

let running: Collaboration | null = null;

afterEach(() => {
	if (running) cleanUp(running);
	running = null;
});

const create = (n: number, by: string) =>
	Array.from({length: n}, (_, index) => ({
		kind: 'create' as const,
		title: `${by}-${index}`,
	}));

const titlesIn = (report: ActorReport): Set<string> =>
	new Set(report.issues.map(entry => entry.split('\t')[1] ?? ''));

/** Titles the board accepted — a refused create is not a lost one. */
const acceptedTitles = (report: ActorReport, expected: string[]): string[] => {
	const refused = report.problems.filter(problem =>
		problem.startsWith('create:'),
	);

	return refused.length > 0 ? [] : expected;
};

/**
 * A sync that lost the race to a concurrent write.
 *
 * Nothing holds a lock on the append path, deliberately: a write that had to
 * wait on a sync would stall the person doing it, and this is the busiest path
 * in the app. So git can find the log dirty at any point while it rebases and
 * refuse — before it starts, at its pre-flight check, or part-way through the
 * replay, which is why this matches three different refusals.
 *
 * The sync fails having changed nothing and the next one picks it up. That is
 * the design, not a defect, and it is not what this file is here to catch: the
 * contract in the header is that an accepted issue does not go missing, and
 * that stays asserted exactly as strictly as before.
 */
const BLOCKED_BY_A_CONCURRENT_WRITE =
	/unstaged changes|would be overwritten|could not detach HEAD/;

/**
 * Tolerated, but counted. An occasional blip is what the design trades for a
 * lock-free write path; every round failing is a regression that would
 * otherwise hide behind the same message. This is the line between them.
 */
const MAX_BLOCKED_SYNCS = 4;

// Anything that is neither of the two known, expected outcomes. One of these
// fails the round it appears in, on its first occurrence.
const unexpectedProblems = (problems: string[]): string[] =>
	problems.filter(
		problem =>
			!/Another process is syncing/.test(problem) &&
			!BLOCKED_BY_A_CONCURRENT_WRITE.test(problem),
	);

const blockedSyncs = (problems: string[]): number =>
	problems.filter(problem => BLOCKED_BY_A_CONCURRENT_WRITE.test(problem))
		.length;

const publishRemoteWork = async (peer: Actor, round: number): Promise<void> => {
	for (let commit = 0; commit < COMMITS_PER_ROUND; commit += 1) {
		const published = await runActor(peer, {
			actions: create(2, `peer-r${round}c${commit}`),
			sync: true,
		});

		expect(published.problems, `peer publishing r${round}c${commit}`).toEqual(
			[],
		);
	}
};

describe('a tool writes while another process syncs the same worktree', () => {
	// Two identities in one events directory: an agent's MCP server beside the
	// user's own GUI. Different log files, one worktree, one git checkout.
	it(
		'keeps issues written by a second tool during a sync',
		async () => {
			const collab = await startCollaboration({names: ['ana', 'bo']});
			running = collab;

			const [ana, bo] = collab.actors as [Actor, Actor];
			const agent = sameMachineTool(ana, 'agent');

			expect(
				(await runActor(ana, {init: true, actions: [], sync: true})).problems,
				'ana creating the project',
			).toEqual([]);
			expect(
				(await runActor(bo, {actions: [], sync: true})).problems,
				'bo joining',
			).toEqual([]);

			// Publishes the agent's log, so it is tracked from here on: an
			// untracked file is not what a rebase or an autostash touches.
			expect(
				(await runActor(agent, {actions: create(1, 'warmup'), sync: true}))
					.problems,
				'agent registering',
			).toEqual([]);

			const expected: string[] = [];
			let blocked = 0;

			for (let round = 0; round < ROUNDS; round += 1) {
				await publishRemoteWork(bo, round);

				const titles = create(WRITES_PER_ROUND, `agent-r${round}`).map(
					action => action.title,
				);

				const [syncing, writing] = await Promise.all([
					runActor(ana, {actions: [], sync: true}),
					runActor(agent, {
						actions: create(WRITES_PER_ROUND, `agent-r${round}`),
						sync: false,
						startDelayMs: 120,
						pauseMs: 25,
					}),
				]);

				expect(
					unexpectedProblems(syncing.problems),
					`ana syncing round ${round}`,
				).toEqual([]);

				blocked += blockedSyncs(syncing.problems);

				expected.push(...acceptedTitles(writing, titles));
			}

			expect(
				blocked,
				'syncs blocked by a concurrent write',
			).toBeLessThanOrEqual(MAX_BLOCKED_SYNCS);

			// Nothing is writing any more, so this one has no excuse.
			const settled = await runActor(agent, {actions: [], sync: true});
			expect(settled.problems, 'agent settling').toEqual([]);

			const received = await runActor(bo, {actions: [], sync: true});
			expect(received.problems, 'bo settling').toEqual([]);

			const here = titlesIn(settled);
			const there = titlesIn(received);

			expect(
				expected.filter(title => !here.has(title)),
				'issues the agent created that are gone from its own machine',
			).toEqual([]);
			expect(
				expected.filter(title => !there.has(title)),
				'issues the agent created that never reached the other machine',
			).toEqual([]);
		},
		TIMEOUT_MS,
	);

	// The sharper case: the writer and the syncer are the same person, so they
	// share one log file — and the remote has new lines for that same file, so
	// the rebase must rewrite exactly the file being appended to.
	it(
		'keeps issues written into the same log file a sync is rewriting',
		async () => {
			const collab = await startCollaboration({
				names: ['ana', 'ana-elsewhere'],
				sharedIdentityFor: [['ana', 'ana-elsewhere']],
			});
			running = collab;

			const [here, elsewhere] = collab.actors as [Actor, Actor];

			expect(
				(await runActor(here, {init: true, actions: [], sync: true})).problems,
				'creating the project',
			).toEqual([]);
			expect(
				(await runActor(elsewhere, {actions: [], sync: true})).problems,
				'the other machine joining',
			).toEqual([]);

			const expected: string[] = [];
			let blocked = 0;

			for (let round = 0; round < ROUNDS; round += 1) {
				await publishRemoteWork(elsewhere, round);

				const titles = create(WRITES_PER_ROUND, `same-r${round}`).map(
					action => action.title,
				);

				const [syncing, writing] = await Promise.all([
					runActor(here, {actions: [], sync: true}),
					runActor(here, {
						actions: create(WRITES_PER_ROUND, `same-r${round}`),
						sync: false,
						startDelayMs: 120,
						pauseMs: 25,
					}),
				]);

				expect(
					unexpectedProblems(syncing.problems),
					`syncing round ${round}`,
				).toEqual([]);

				blocked += blockedSyncs(syncing.problems);

				expected.push(...acceptedTitles(writing, titles));
			}

			expect(
				blocked,
				'syncs blocked by a concurrent write',
			).toBeLessThanOrEqual(MAX_BLOCKED_SYNCS);

			// Nothing is writing any more, so this one has no excuse.
			const settled = await runActor(here, {actions: [], sync: true});
			expect(settled.problems, 'settling').toEqual([]);

			const received = await runActor(elsewhere, {actions: [], sync: true});
			expect(received.problems, 'the other machine settling').toEqual([]);

			const mine = titlesIn(settled);
			const theirs = titlesIn(received);

			expect(
				expected.filter(title => !mine.has(title)),
				'issues gone from the machine that wrote them',
			).toEqual([]);
			expect(
				expected.filter(title => !theirs.has(title)),
				'issues that never reached the other machine',
			).toEqual([]);
		},
		TIMEOUT_MS,
	);
});
