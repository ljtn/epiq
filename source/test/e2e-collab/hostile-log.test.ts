/**
 * A peer's event log arrives over git as arbitrary bytes. Nothing on the read
 * path may assume a well-behaved writer produced them: a half-written line
 * survives `merge=union` into every clone, an id is chosen by whoever writes
 * it, and the log is append-only, so anything that stops the board here stops
 * it for everybody, permanently.
 *
 * Every case asserts the same four things: the board still opens on both
 * machines, both derive the same order from the same events, both see the same
 * issues, and writes still work afterwards.
 */
import {afterAll, describe, expect, it} from 'vitest';
import {encodeTime} from 'ulid';
import {
	appendRawToOwnLog,
	cleanUp,
	idsInStateWorktree,
	runActor,
	startCollaboration,
	stateBranchRootFor,
	type Actor,
	type Collaboration,
} from './harness.js';
import {readEventIds} from './log-reader.js';

const TIMEOUT_MS = 240_000;

// The cases run concurrently, so each keeps its own project until the end.
const running: Collaboration[] = [];

afterAll(() => {
	for (const collab of running) cleanUp(collab);
});

// The actor writes `<sanitized id>.<sanitized name>.jsonl`; the harness gives
// every actor a plain lowercase name and a ULID id, so this matches.
const logFileFor = (actor: Actor): string =>
	`${actor.userId.toLowerCase()}.${actor.name}.jsonl`;

const line = (id: string, ref: string | null, payload: object): string =>
	JSON.stringify({v: 1, id: [id, ref], ...payload});

type Pair = {alice: Actor; mallory: Actor};

/** A project with two collaborators, both synced and holding the same board. */
const openProject = async (): Promise<Pair> => {
	const collab = await startCollaboration({names: ['alice', 'mallory']});
	running.push(collab);

	const [alice, mallory] = collab.actors as [Actor, Actor];

	expect(
		(await runActor(alice, {init: true, actions: [], sync: true})).problems,
		'alice creating the project',
	).toEqual([]);

	expect(
		(await runActor(mallory, {actions: [], sync: true})).problems,
		'mallory joining',
	).toEqual([]);

	return {alice, mallory};
};

/**
 * Mallory publishes whatever bytes she appended, then Alice pulls them and
 * writes something of her own. The assertions live here because every case
 * wants the same ones.
 */
const publishAndSettle = async ({alice, mallory}: Pair, label: string) => {
	const published = await runActor(mallory, {actions: [], sync: true});
	expect(published.problems, `${label}: mallory publishing`).toEqual([]);

	const received = await runActor(alice, {
		actions: [{kind: 'create', title: `${label}-after`}],
		sync: true,
	});

	// The board opened, and it still accepts writes. Both were lost outright
	// before the fixes these cases cover.
	expect(received.problems, `${label}: alice after pulling`).toEqual([]);
	expect(
		received.issues.some(issue => issue.endsWith(`${label}-after`)),
		`${label}: alice's own write is on her board`,
	).toBe(true);

	const settled = await runActor(mallory, {actions: [], sync: true});
	expect(settled.problems, `${label}: mallory settling`).toEqual([]);

	// Same events, same derived order, same board. This is the contract.
	expect(new Set(settled.seenEventIds), `${label}: same event set`).toEqual(
		new Set(received.seenEventIds),
	);
	expect(settled.orderedEventIds, `${label}: same derived order`).toEqual(
		received.orderedEventIds,
	);
	expect(settled.issues, `${label}: same board`).toEqual(received.issues);

	return {received, settled};
};

describe.concurrent(
	'a peer publishes a log this build cannot fully read',
	() => {
		it(
			'survives a half-written last line',
			async () => {
				const pair = await openProject();

				// No trailing newline, which is what `merge=union` splices the other
				// side's first line onto.
				appendRawToOwnLog(
					pair.mallory,
					logFileFor(pair.mallory),
					'{"v":1,"id":["01H0000000000000000000000Z",null],"lock.node"',
				);

				await publishAndSettle(pair, 'truncated');
			},
			TIMEOUT_MS,
		);

		it(
			'survives a line that parses as JSON but not as an envelope',
			async () => {
				const pair = await openProject();

				appendRawToOwnLog(
					pair.mallory,
					logFileFor(pair.mallory),
					JSON.stringify({v: 1, id: 'not-a-tuple', 'lock.node': {id: 'x'}}) +
						'\n',
				);

				await publishAndSettle(pair, 'bad-envelope');
			},
			TIMEOUT_MS,
		);

		it(
			'survives an event id at the ULID timestamp ceiling',
			async () => {
				const pair = await openProject();

				// `decodeTime(edge) + 1` cannot be encoded, so this used to make every
				// later write fail on every machine, forever.
				appendRawToOwnLog(
					pair.mallory,
					logFileFor(pair.mallory),
					line('7ZZZZZZZZZZZZZZZZZZZZZZZZZ', null, {'lock.node': {id: 'x'}}) +
						'\n',
				);

				await publishAndSettle(pair, 'ulid-ceiling');
			},
			TIMEOUT_MS,
		);

		it(
			'survives an event id that is not a ULID at all',
			async () => {
				const pair = await openProject();

				appendRawToOwnLog(
					pair.mallory,
					logFileFor(pair.mallory),
					line('!!not-a-ulid!!', null, {'lock.node': {id: 'x'}}) + '\n',
				);

				await publishAndSettle(pair, 'non-ulid');
			},
			TIMEOUT_MS,
		);

		it(
			'survives a second root event dated before the workspace',
			async () => {
				const pair = await openProject();

				appendRawToOwnLog(
					pair.mallory,
					logFileFor(pair.mallory),
					line(encodeTime(0, 10) + '0000000000000000', null, {
						'lock.node': {id: 'x'},
					}) + '\n',
				);

				await publishAndSettle(pair, 'forged-root');
			},
			TIMEOUT_MS,
		);

		// The convergence case: whichever of the two the loader keeps, both
		// machines have to keep the same one. Ties used to be settled by
		// `readdirSync` order, so each machine kept whichever it read first.
		it(
			'derives one order when two events share an id',
			async () => {
				const pair = await openProject();

				const existing = idsInStateWorktree(pair.alice);
				const victim = existing.at(-1);
				expect(victim, 'a published event to collide with').toBeDefined();

				appendRawToOwnLog(
					pair.mallory,
					logFileFor(pair.mallory),
					line(victim as string, null, {
						'edit.title': {id: 'x', name: 'collision'},
					}) + '\n',
				);

				await publishAndSettle(pair, 'duplicate-id');
			},
			TIMEOUT_MS,
		);
	},
);

describe.concurrent('a log longer than the call stack', () => {
	it(
		'opens on every machine past the old recursion ceiling',
		async () => {
			const pair = await openProject();

			// Recursing the causal chain overflowed at ~4.7k events, and every
			// event refs its predecessor, so a log is one chain as deep as it is
			// long. Written straight into the log rather than through 6k API calls:
			// this is a test of the loader, not of throughput.
			const edge = idsInStateWorktree(pair.mallory).at(-1) ?? null;
			const lines: string[] = [];
			let previous = edge;

			for (let index = 0; index < 6_000; index++) {
				const id =
					encodeTime(1_700_000_000_000 + index, 10) + 'CHAIN000000000M0';
				lines.push(line(id, previous, {'lock.node': {id: 'x'}}));
				previous = id;
			}

			appendRawToOwnLog(
				pair.mallory,
				logFileFor(pair.mallory),
				lines.join('\n') + '\n',
			);

			const {received} = await publishAndSettle(pair, 'long-chain');

			expect(
				readEventIds(stateBranchRootFor(pair.alice)).length,
				'alice holds the whole chain',
			).toBeGreaterThan(6_000);
			expect(
				received.orderedEventIds.length,
				'and the loader ordered all of it',
			).toBeGreaterThan(6_000);
		},
		TIMEOUT_MS,
	);
});
