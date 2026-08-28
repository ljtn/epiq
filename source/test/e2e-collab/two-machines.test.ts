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

describe('one person, two machines', () => {
	// Per-actor log files make conflicts impossible *between* people, but one
	// person on a laptop and a desktop appends to the same file from both, and
	// the two sides diverge textually.
	it(
		'keeps what was written on both machines',
		async () => {
			const collab = await startCollaboration({
				names: ['laptop', 'desktop', 'other'],
				// laptop and desktop are the same person.
				sharedIdentityFor: [['laptop', 'desktop']],
			});
			running = collab;

			const [laptop, desktop, other] = collab.actors as [
				(typeof collab.actors)[number],
				(typeof collab.actors)[number],
				(typeof collab.actors)[number],
			];

			expect(
				(await runActor(other, {init: true, actions: [], sync: true})).problems,
			).toEqual([]);

			for (const actor of [laptop, desktop]) {
				expect(
					(await runActor(actor, {actions: [], sync: true})).problems,
					`${actor.name} joining`,
				).toEqual([]);
			}

			// Both machines write before either syncs, so the same log file gains
			// different lines on each side.
			const onLaptop = await runActor(laptop, {
				actions: create(2, 'laptop'),
				sync: false,
			});
			const onDesktop = await runActor(desktop, {
				actions: create(2, 'desktop'),
				sync: false,
			});

			expect(onLaptop.problems, 'laptop writing').toEqual([]);
			expect(onDesktop.problems, 'desktop writing').toEqual([]);

			const written = new Set([
				...onLaptop.authoredEventIds,
				...onDesktop.authoredEventIds,
			]);

			// Laptop publishes first, so desktop's push is the one that has to
			// reconcile a file that moved underneath it.
			const laptopSync = await runActor(laptop, {actions: [], sync: true});
			expect(laptopSync.problems, 'laptop syncing').toEqual([]);

			const desktopSync = await runActor(desktop, {actions: [], sync: true});
			expect(desktopSync.problems, 'desktop syncing').toEqual([]);

			const settledAll = [];

			for (const actor of [laptop, desktop, other]) {
				const settled = await runActor(actor, {actions: [], sync: true});
				expect(settled.problems, `${actor.name} settling`).toEqual([]);

				const seen = new Set(settled.seenEventIds);
				expect(
					[...written].filter(id => !seen.has(id)),
					`events missing from ${actor.name}`,
				).toEqual([]);

				settledAll.push([actor.name, settled] as const);
			}

			// Union merge duplicates lines and interleaves them differently on
			// each side, so this is where a file-order-dependent sort would show
			// up: same events, different order, divergent boards.
			const [reference, ...others] = settledAll;
			for (const [name, report] of others) {
				expect(
					report.orderedEventIds,
					`${name} orders events differently`,
				).toEqual(reference?.[1].orderedEventIds);

				expect(
					new Set(report.orderedEventIds).size,
					`${name} kept a duplicated line`,
				).toBe(report.orderedEventIds.length);
			}
		},
		TIMEOUT_MS,
	);
});
