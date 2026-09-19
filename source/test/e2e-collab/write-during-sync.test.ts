/**
 * A second tool writing while this one syncs — an agent's MCP server beside the
 * user's GUI, two log files in one worktree.
 *
 * Its own file rather than a second test beside the same-log case: a file is
 * what vitest hands a worker, so the two longest tests in the suite sharing one
 * file made the job as long as both of them together. See
 * `write-during-sync.helper.ts` for what they are both about.
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
});
