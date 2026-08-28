import {afterEach, describe, expect, it} from 'vitest';
import {
	cleanUp,
	runActor,
	startCollaboration,
	type Collaboration,
} from './harness.js';
import type {ActorReport} from './protocol.js';

const TIMEOUT_MS = 240_000;

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

const problemsMatching = (reports: ActorReport[], pattern: RegExp): string[] =>
	reports.flatMap(report => report.problems.filter(p => pattern.test(p)));

describe('one person, several tools', () => {
	// A GUI's autosync, a TUI and an MCP call all sync through the *same* state
	// worktree, on timers, so two syncs overlapping is ordinary. They share
	// FETCH_HEAD, and `pull --rebase` rebases onto whatever it finds there.
	it(
		'survives its own tools syncing at the same moment',
		async () => {
			const collab = await startCollaboration({names: ['ana', 'bo']});
			running = collab;

			const [ana, bo] = collab.actors as [
				(typeof collab.actors)[number],
				(typeof collab.actors)[number],
			];

			expect(
				(await runActor(ana, {init: true, actions: [], sync: true})).problems,
			).toEqual([]);
			expect((await runActor(bo, {actions: [], sync: true})).problems).toEqual(
				[],
			);

			const races: ActorReport[] = [];

			// Repeated: this is a race, and one attempt proves little either way.
			for (let round = 0; round < 4; round += 1) {
				// Something for ana to pull, or the fetch has no work and the
				// window never opens.
				const published = await runActor(bo, {
					actions: create(2, `bo-r${round}`),
					sync: true,
				});
				expect(published.problems, `bo publishing round ${round}`).toEqual([]);

				// Ana's own tools, all against her single worktree.
				races.push(
					...(await Promise.all([
						runActor(ana, {actions: [], sync: true}),
						runActor(ana, {actions: [], sync: true}),
						runActor(ana, {actions: [], sync: true}),
					])),
				);
			}

			expect(
				problemsMatching(races, /Cannot rebase onto multiple branches/),
				'FETCH_HEAD race',
			).toEqual([]);

			// Whatever the concurrency did, ana must still end up with bo's work.
			const settled = await runActor(ana, {actions: [], sync: true});
			const bosWork = await runActor(bo, {actions: [], sync: true});

			expect(settled.problems, 'ana settling').toEqual([]);
			expect(bosWork.problems, 'bo settling').toEqual([]);

			const seen = new Set(settled.seenEventIds);
			expect(
				bosWork.authoredEventIds.filter(id => !seen.has(id)),
				"bo's events missing from ana",
			).toEqual([]);
		},
		TIMEOUT_MS,
	);
});
