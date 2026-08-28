import {afterEach, describe, expect, it} from 'vitest';
import {
	cleanUp,
	runActor,
	startCollaboration,
	type Collaboration,
} from './harness.js';
import type {ActorAction, ActorReport} from './protocol.js';

// Actors are separate processes doing real git against a shared remote, so this
// is slower than anything in the unit suite and lives outside `npm test`.
const TIMEOUT_MS = 180_000;

let running: Collaboration | null = null;

afterEach(() => {
	if (running) cleanUp(running);
	running = null;
});

const create = (n: number, by: string): ActorAction[] =>
	Array.from({length: n}, (_, index) => ({
		kind: 'create' as const,
		title: `${by}-${index}`,
	}));

// Every id anyone wrote has to be in everyone's log. Reported as the ids that
// went missing, so a failure names them instead of comparing two long lists.
const missingFrom = (report: ActorReport, authored: Set<string>): string[] => {
	const seen = new Set(report.seenEventIds);

	return [...authored].filter(id => !seen.has(id));
};

const duplicatesIn = (report: ActorReport): string[] => {
	const counts = new Map<string, number>();
	for (const id of report.seenEventIds) {
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}

	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([id, count]) => `${id} x${count}`);
};

describe('collaboration', () => {
	it(
		'loses nothing when three people work at once',
		async () => {
			const collab = await startCollaboration({
				names: ['ana', 'bo', 'cy'],
			});
			running = collab;

			const [ana, bo, cy] = collab.actors as [
				(typeof collab.actors)[number],
				(typeof collab.actors)[number],
				(typeof collab.actors)[number],
			];

			const founded = await runActor(ana, {
				init: true,
				actions: [],
				sync: true,
			});
			expect(founded.problems).toEqual([]);

			// Everyone else picks the project up from the remote.
			for (const actor of [bo, cy]) {
				const joined = await runActor(actor, {actions: [], sync: true});
				expect(joined.problems, `${actor.name} joining`).toEqual([]);
			}

			// The part that matters: three writers, no coordination between them.
			const rounds = await Promise.all([
				runActor(ana, {actions: create(3, 'ana'), sync: true}),
				runActor(bo, {actions: create(3, 'bo'), sync: true}),
				runActor(cy, {actions: create(3, 'cy'), sync: true}),
			]);

			const authored = new Set(rounds.flatMap(r => r.authoredEventIds));
			expect(authored.size).toBeGreaterThan(0);

			// Twice: the first push publishes, the second pulls what the others
			// published while it was pushing.
			const settled: ActorReport[] = [];
			for (const pass of [0, 1]) {
				void pass;
				for (const actor of collab.actors) {
					const report = await runActor(actor, {actions: [], sync: true});
					settled[collab.actors.indexOf(actor)] = report;
				}
			}

			for (const report of settled) {
				expect(report.problems, `${report.userId} settling`).toEqual([]);
				expect(
					missingFrom(report, authored),
					`events missing from ${report.userId}`,
				).toEqual([]);
				expect(duplicatesIn(report), `duplicates in ${report.userId}`).toEqual(
					[],
				);
			}

			// And they agree on the board, not just on the log.
			const [first, ...rest] = settled;
			for (const report of rest) {
				expect(report.issues, `${report.userId} disagrees`).toEqual(
					first?.issues,
				);
			}
		},
		TIMEOUT_MS,
	);
});
