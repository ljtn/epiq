/**
 * A peer's log line is arbitrary bytes. `hostile-log.test.ts` covers the
 * envelope — a truncated line, a forged root, a duplicate id — because the
 * envelope is the only part the loader parses.
 *
 * The payload is not parsed at all. `fromPersistedEvent` hands
 * `entry[action]` to the materializer as-is, so a line that is valid JSON, at
 * a supported schema version, naming an action this build knows, reaches a
 * handler with whatever shape it likes. These cases ask what that costs.
 *
 * Every case asserts the same thing: the board still opens. A line that
 * arrives over `merge=union` is in every clone permanently, so anything that
 * stops the board here stops it for everybody, forever.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, describe, expect, it} from 'vitest';
import {createDefaultEvents} from '../lib/event/event-boot.js';
import {persist} from '../lib/event/event-persist.js';
import {isFail} from '../lib/model/result-types.js';

const RUNNER = fileURLToPath(
	new URL('./helpers/hostile-boot-runner.ts', import.meta.url),
);
const TSX = fileURLToPath(
	new URL('../../node_modules/.bin/tsx', import.meta.url),
);

// Generous: a cold `tsx` start plus a replay of a dozen events. Anything that
// reaches this is not slow, it is not finishing.
const BOOT_TIMEOUT_MS = 30_000;

const AUTHOR = {
	userId: '01JCOLLAB0000000000000000',
	userName: 'ana',
};
const HOSTILE_LOG = '01JHOSTILE000000000000000.mallory.jsonl';

const roots: string[] = [];

afterAll(() => {
	for (const root of roots) fs.rmSync(root, {recursive: true, force: true});
});

/** A state-branch root holding a normal, freshly initialized board. */
const seedBoard = (): {root: string; edge: string; swimlaneId: string} => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-hostile-payload-'));
	roots.push(root);

	const defaults = createDefaultEvents(AUTHOR);
	if (isFail(defaults)) throw new Error(defaults.message);

	let edge = '';
	let swimlaneId = '';

	for (const event of defaults.value) {
		const written = persist({event, rootDir: root});
		if (isFail(written)) throw new Error(written.message);

		edge = written.value.entry.id[0];
		if (event.action === 'add.swimlane' && !swimlaneId) {
			swimlaneId = event.payload.id;
		}
	}

	return {root, edge, swimlaneId};
};

/**
 * Appends raw lines to a peer's log, chained after the real history so they
 * order last. Ids are fixed and ascending, which is what a peer's own writer
 * would have produced.
 */
const appendHostile = (
	root: string,
	edge: string,
	payloads: Array<Record<string, unknown>>,
): void => {
	const logPath = path.join(root, '.epiq', 'events', HOSTILE_LOG);
	let previous: string | null = edge;

	for (const [index, payload] of payloads.entries()) {
		const id = `01JZZZZZZZZZZZZZZZZZZZZZ${String(index).padStart(2, '0')}`;

		fs.appendFileSync(
			logPath,
			JSON.stringify({v: 1, id: [id, previous], ...payload}) + '\n',
			'utf8',
		);

		previous = id;
	}
};

type BootOutcome =
	| {outcome: 'booted' | 'boot-failed' | 'load-failed'; message: string}
	| {outcome: 'threw'; message: string; stack?: string}
	| {outcome: 'did-not-finish'; message: string};

/**
 * Boots the board in a child process. A run that has to be killed is the
 * finding, not an infrastructure problem, so it is reported rather than thrown.
 */
const bootInChildProcess = (root: string): Promise<BootOutcome> =>
	new Promise(resolve => {
		const child = spawn(TSX, [RUNNER, root], {
			env: {
				...process.env,
				EPIQ_GLOBAL_DIR: root,
				IS_LOCAL: 'true',
				EPIQ_LOG_LEVEL: 'error',
			},
			cwd: root,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stdout = '';
		let stderr = '';
		let settled = false;

		const finish = (value: BootOutcome) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.kill('SIGKILL');
			resolve(value);
		};

		const timer = setTimeout(
			() =>
				finish({
					outcome: 'did-not-finish',
					message: `no result within ${BOOT_TIMEOUT_MS}ms`,
				}),
			BOOT_TIMEOUT_MS,
		);

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', chunk => (stdout += chunk));
		child.stderr.on('data', chunk => (stderr += chunk));

		child.on('error', error =>
			finish({outcome: 'threw', message: error.message}),
		);

		child.on('close', () => {
			const line = stdout
				.split('\n')
				.map(entry => entry.trim())
				.filter(Boolean)
				.at(-1);

			if (!line) {
				finish({
					outcome: 'threw',
					message: `child produced no report\n${stderr.slice(-2000)}`,
				});
				return;
			}

			finish(JSON.parse(line) as BootOutcome);
		});
	});

const bootWith = async (
	build: (swimlaneId: string) => Array<Record<string, unknown>>,
): Promise<BootOutcome> => {
	const {root, edge, swimlaneId} = seedBoard();
	appendHostile(root, edge, build(swimlaneId));

	return bootInChildProcess(root);
};

const RANK_A = '400000000000000000000000';

describe('a peer publishes a known action with a payload of its own shape', () => {
	// The board is allowed to skip the event. It is not allowed to stop.
	const opens = (outcome: BootOutcome) => outcome.outcome;

	it('survives a rank that is not a string', async () => {
		const outcome = await bootWith(swimlaneId => [
			{
				'add.issue': {
					id: '01JISSUEHONEST0000000000A0',
					name: 'honest neighbour',
					parent: swimlaneId,
					rank: RANK_A,
				},
			},
			{
				'add.issue': {
					id: '01JISSUERANK00000000000000',
					name: 'numeric rank',
					parent: swimlaneId,
					rank: 42,
				},
			},
		]);

		expect(opens(outcome), JSON.stringify(outcome)).toBe('booted');
	});

	it('survives a rank that is missing entirely', async () => {
		const outcome = await bootWith(swimlaneId => [
			{
				'add.issue': {
					id: '01JISSUEHONEST0000000000B0',
					name: 'honest neighbour',
					parent: swimlaneId,
					rank: RANK_A,
				},
			},
			{
				'add.issue': {
					id: '01JISSUENORANK000000000000',
					name: 'no rank',
					parent: swimlaneId,
				},
			},
		]);

		expect(opens(outcome), JSON.stringify(outcome)).toBe('booted');
	});

	// The cycle guard walks the parent chain to answer the question, so it is
	// the first thing a cycle stops.
	it('survives a move into a node that is its own parent', async () => {
		const loop = '01JISSUESELFPARENT00000000';
		const victim = '01JISSUEVICTIM000000000000';

		const outcome = await bootWith(swimlaneId => [
			{
				'add.issue': {
					id: loop,
					name: 'self parented',
					parent: loop,
					rank: RANK_A,
				},
			},
			{
				'add.issue': {
					id: victim,
					name: 'about to be moved',
					parent: swimlaneId,
					rank: RANK_A,
				},
			},
			{'move.node': {id: victim, parent: loop, rank: RANK_A}},
		]);

		expect(opens(outcome), JSON.stringify(outcome)).toBe('booted');
	});

	it('survives a rebalance whose ranks are not an object', async () => {
		const outcome = await bootWith(swimlaneId => [
			{'rebalance.children': {parent: swimlaneId, ranks: null}},
		]);

		expect(opens(outcome), JSON.stringify(outcome)).toBe('booted');
	});

	it('survives an id that is not a string', async () => {
		const outcome = await bootWith(swimlaneId => [
			{
				'add.issue': {
					id: 7,
					name: 'numeric id',
					parent: swimlaneId,
					rank: RANK_A,
				},
			},
		]);

		expect(opens(outcome), JSON.stringify(outcome)).toBe('booted');
	});

	// `createNode` writes into the node map unconditionally, and the
	// materializer's `isFail` branch can never fire on a duplicate. A second
	// `add.*` naming a live id replaces that node wholesale — title, rank,
	// parent, description, tags, assignees and its readonly flag.
	it('does not let a second add replace a live node', async () => {
		const victim = '01JISSUEVICTIMID0000000000';

		const {root, edge, swimlaneId} = seedBoard();

		appendHostile(root, edge, [
			{
				'add.issue': {
					id: victim,
					name: 'the-real-issue',
					parent: swimlaneId,
					rank: RANK_A,
				},
			},
			{
				'add.issue': {
					id: victim,
					name: 'overwritten',
					parent: swimlaneId,
					rank: RANK_A,
				},
			},
		]);

		const outcome = await bootInChildProcess(root);

		expect(outcome.outcome, JSON.stringify(outcome)).toBe('booted');
		expect(
			(outcome as {titles?: string[]}).titles ?? [],
			'the original issue after a duplicate add',
		).toContain('the-real-issue');
	});

	it('survives a title that is not a string', async () => {
		const outcome = await bootWith(swimlaneId => [
			{'edit.title': {id: swimlaneId, name: {nested: true}}},
		]);

		expect(opens(outcome), JSON.stringify(outcome)).toBe('booted');
	});
});
