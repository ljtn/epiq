/**
 * The writer and the syncer are the same person, so they share one log file and
 * the rebase must rewrite exactly the file being appended to.
 *
 * Its own file for the reason the other half of this pair is: see
 * `write-during-sync.helper.ts`, which holds what they both measure with.
 */
import {afterEach, describe, expect, it} from 'vitest';
import {
	cleanUp,
	runActor,
	startCollaboration,
	type Actor,
	type Collaboration,
} from './harness.js';
import {
	acceptedTitles,
	blockedSyncs,
	create,
	MAX_BLOCKED_SYNCS,
	publishRemoteWork,
	ROUNDS,
	TIMEOUT_MS,
	titlesIn,
	unexpectedProblems,
	WRITES_PER_ROUND,
} from './write-during-sync.helper.js';

let running: Collaboration | null = null;

afterEach(() => {
	if (running) cleanUp(running);
	running = null;
});

describe('a tool writes into the log file a sync is rewriting', () => {
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
