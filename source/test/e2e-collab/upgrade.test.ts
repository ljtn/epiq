/**
 * What a machine upgraded across ZFZFW9D is still holding when it next syncs.
 *
 * Before it, an actor's log was `<id>.<name>.jsonl` and the pending file beside
 * it `<id>~pending.<name>.jsonl`. Since it, both drop the name. Anything
 * written but not yet synced is sitting in the old pending file at the moment
 * of the upgrade, and a sync that goes looking under the new name finds
 * nothing: the lines reach no tracked log, so no commit and no peer's clone,
 * while the board that wrote them goes on showing them as though they had been
 * published. Nothing reports it, and no later sync picks them up.
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

			// What the old build left: one line still pending, and one already
			// folded into the tracked log but never committed — the two places a
			// line can be sitting when the upgrade lands.
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
