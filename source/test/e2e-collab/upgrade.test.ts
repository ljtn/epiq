/**
 * Unsynced lines in a pending file under the older `<id>~pending.<name>.jsonl`
 * name must still be synced after an upgrade.
 */
import {afterEach, describe, expect, it} from 'vitest';
import {
	appendRawToOwnLog,
	cleanUp,
	runActor,
	startCollaboration,
	stateBranchRootFor,
	type Actor,
	type Collaboration,
} from './harness.js';
import {readEventIds} from './log-reader.js';

const TIMEOUT_MS = 240_000;

let running: Collaboration | null = null;

afterEach(() => {
	if (running) cleanUp(running);
	running = null;
});

// The names the old build wrote. The harness gives every actor a ULID id and a
// plain lowercase name, so `sanitizeFilePart` is the identity on both.
const legacyPendingFor = (actor: Actor): string =>
	`${actor.userId.toLowerCase()}~pending.${actor.name}.jsonl`;

const legacyTrackedFor = (actor: Actor): string =>
	`${actor.userId.toLowerCase()}.${actor.name}.jsonl`;

const line = (id: string): string =>
	JSON.stringify({v: 1, id: [id, null], 'lock.node': {id: 'upgrade-probe'}}) +
	'\n';

describe('a machine upgraded across the log file rename', () => {
	it(
		'publishes the lines it left behind under the old names',
		async () => {
			const collab = await startCollaboration({names: ['alice', 'bob']});
			running = collab;

			const [alice, bob] = collab.actors as [Actor, Actor];

			expect(
				(await runActor(alice, {init: true, actions: [], sync: true})).problems,
				'alice creating the project',
			).toEqual([]);

			expect(
				(await runActor(bob, {actions: [], sync: true})).problems,
				'bob joining',
			).toEqual([]);

			// One line still pending, one folded but uncommitted.
			const PENDING = '01H0000000000000000000000Y';
			const FOLDED = '01H0000000000000000000000Z';

			appendRawToOwnLog(alice, legacyPendingFor(alice), line(PENDING));
			appendRawToOwnLog(alice, legacyTrackedFor(alice), line(FOLDED));

			expect(
				(await runActor(alice, {actions: [], sync: true})).problems,
				'alice syncing after the upgrade',
			).toEqual([]);

			expect(
				(await runActor(bob, {actions: [], sync: true})).problems,
				'bob pulling',
			).toEqual([]);

			const seen = readEventIds(stateBranchRootFor(bob));

			expect(seen, 'the pending line never reached bob').toContain(PENDING);
			expect(seen, 'the folded line never reached bob').toContain(FOLDED);
		},
		TIMEOUT_MS,
	);
});
