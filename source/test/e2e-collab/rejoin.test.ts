import {afterEach, describe, expect, it} from 'vitest';
import {
	cleanUp,
	runActor,
	startCollaboration,
	type Collaboration,
} from './harness.js';

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

describe('someone who was away', () => {
	// Working offline is the ordinary case for this tool, so the events written
	// while away have to survive and the catch-up has to go both directions.
	it(
		'keeps what it wrote while away and catches up on the rest',
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

			// Bo goes away and keeps working, never syncing.
			const away = [];
			for (let round = 0; round < 3; round += 1) {
				away.push(
					await runActor(bo, {
						actions: create(2, `away-r${round}`),
						sync: false,
					}),
				);
			}

			for (const [round, report] of away.entries()) {
				expect(report.problems, `bo offline round ${round}`).toEqual([]);
			}

			// Meanwhile ana carries on and publishes.
			const anaWorked = await runActor(ana, {
				actions: create(3, 'ana'),
				sync: true,
			});
			expect(anaWorked.problems, 'ana while bo is away').toEqual([]);

			const bosOfflineWork = new Set(
				away.flatMap(report => report.authoredEventIds),
			);
			expect(bosOfflineWork.size).toBeGreaterThan(0);

			// Bo comes back. Twice: publish, then collect what landed meanwhile.
			for (const pass of [0, 1]) {
				const rejoined = await runActor(bo, {actions: [], sync: true});
				expect(rejoined.problems, `bo rejoining pass ${pass}`).toEqual([]);
			}

			const bo1 = await runActor(bo, {actions: [], sync: true});
			const ana1 = await runActor(ana, {actions: [], sync: true});

			const anaSees = new Set(ana1.seenEventIds);
			expect(
				[...bosOfflineWork].filter(id => !anaSees.has(id)),
				'work bo did offline never reached ana',
			).toEqual([]);

			const boSees = new Set(bo1.seenEventIds);
			expect(
				anaWorked.authoredEventIds.filter(id => !boSees.has(id)),
				'work ana did never reached bo',
			).toEqual([]);

			expect(bo1.issues, 'boards disagree').toEqual(ana1.issues);
		},
		TIMEOUT_MS,
	);
});
