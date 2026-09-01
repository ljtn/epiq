/**
 * A sync that dies partway through, and the writes that come after it.
 *
 * Every git call is capped at 10 seconds and SIGTERMed at the cap, an agent's
 * MCP server is killed when its session ends, and a laptop sleeps mid-fetch.
 * All three leave the state worktree in a state git calls "rebase in
 * progress": HEAD detached, an autostash holding whatever was uncommitted.
 *
 * The next epiq process recovers by running `git rebase --abort`, and an abort
 * resets the working tree. Anything a *write* put in that directory in the
 * meantime is in the working tree and not in any commit — so the question this
 * asks is whether recovery takes those writes with it.
 *
 * The board is allowed to be behind. It is not allowed to lose an issue it
 * said it had created.
 */
import {afterEach, describe, expect, it} from 'vitest';
import {
	cleanUp,
	runActor,
	runActorAndKill,
	startCollaboration,
	type Actor,
	type Collaboration,
} from './harness.js';
import type {ActorReport} from './protocol.js';

const TIMEOUT_MS = 900_000;
const ROUNDS = 8;
const COMMITS_PER_ROUND = 6;
const WRITES_PER_ROUND = 6;

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

describe('a sync killed partway through', () => {
	it(
		'does not take later writes with it when the next process recovers',
		async () => {
			const collab = await startCollaboration({names: ['ana', 'bo']});
			running = collab;

			const [ana, bo] = collab.actors as [Actor, Actor];

			expect(
				(await runActor(ana, {init: true, actions: [], sync: true})).problems,
				'ana creating the project',
			).toEqual([]);
			expect(
				(await runActor(bo, {actions: [], sync: true})).problems,
				'bo joining',
			).toEqual([]);

			const expected: string[] = [];

			for (let round = 0; round < ROUNDS; round += 1) {
				// Work for ana's rebase to be partway through when it dies.
				for (let commit = 0; commit < COMMITS_PER_ROUND; commit += 1) {
					const published = await runActor(bo, {
						actions: create(2, `bo-r${round}c${commit}`),
						sync: true,
					});
					expect(
						published.problems,
						`bo publishing r${round}c${commit}`,
					).toEqual([]);
				}

				// Killed at a different point each round, so the window lands
				// somewhere different in the sync every time.
				await runActorAndKill(ana, {
					actions: [],
					sync: true,
					killAfterMs: 900 + round * 250,
				});

				// Now write, into whatever the killed process left behind.
				const titles = create(WRITES_PER_ROUND, `after-kill-r${round}`).map(
					action => action.title,
				);

				const writing = await runActor(ana, {
					actions: create(WRITES_PER_ROUND, `after-kill-r${round}`),
					sync: false,
				});

				const refused = writing.problems.filter(problem =>
					problem.startsWith('create:'),
				);

				// A refusal is a legitimate answer — the board saying no is not the
				// board losing something. Only what it accepted is tracked.
				if (refused.length === 0) expected.push(...titles);

				// And then a normal sync, which is where recovery happens.
				const recovered = await runActor(ana, {actions: [], sync: true});
				expect(
					recovered.problems.filter(
						problem => !/Another process is syncing/.test(problem),
					),
					`ana recovering after round ${round}`,
				).toEqual([]);

				const stillHere = titlesIn(recovered);
				expect(
					titles.filter(
						title => expected.includes(title) && !stillHere.has(title),
					),
					`issues written after the kill in round ${round}`,
				).toEqual([]);
			}

			const settled = await runActor(ana, {actions: [], sync: true});
			const received = await runActor(bo, {actions: [], sync: true});

			expect(settled.problems, 'ana settling').toEqual([]);
			expect(received.problems, 'bo settling').toEqual([]);

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
