import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ensureContributorCurrent} from '../lib/board/board-contributor.js';
import {loadActorNames, materialize} from '../lib/board/board-log.js';
import {
	getPersistFileName,
	ownEventFileNames,
} from '../lib/event/event-persist.js';
import {createRebalanceChildrenEvent} from '../lib/board/create-rebalance-children-event.js';
import {actorOf, AppEvent} from '../lib/board/board-events.model.js';
import {isFail} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {patchSettingsState, User} from '../lib/state/settings.state.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex} from '../lib/utils/rank.js';

// An event's actor id comes off its log file name; its display name from the
// registry. These pin the file-name fallback for authors the registry lacks.

const ALICE = '01KSAYRA4GHEKJP888WFBWBRDD';
const BOB = '01KRNH6T93JJV0B09W1NF2MS4J';
const ROOT = 'identity-root';

let root = '';

const eventsDir = () => path.join(root, '.epiq', 'events');

const writeLog = (fileName: string, ids: string[]) => {
	fs.mkdirSync(eventsDir(), {recursive: true});
	fs.writeFileSync(
		path.join(eventsDir(), fileName),
		ids
			.map(id =>
				JSON.stringify({
					v: 1,
					id: [id, null],
					'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
				}),
			)
			.join('\n') + '\n',
	);
};

const rank = () => {
	const result = bigIntToHex(1n);
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-identity-'));
	initWorkspaceState(nodes.workspace(ROOT, 'Identity Root', rank()));
});

afterEach(() => {
	fs.rmSync(root, {recursive: true, force: true});
	patchSettingsState({userId: null, userName: null});
});

describe('names a log file name carries', () => {
	// The old `<id>.<name>.jsonl` shape.
	it('reads a name off a pre-ZFZFW9D file name', () => {
		writeLog(`${ALICE.toLowerCase()}.alice.jsonl`, [
			'01H0000000000000000000000A',
		]);

		expect(loadActorNames(root).get(ALICE)).toBe('alice');
	});

	// The shape every log has had since. The id still attributes; there is
	// simply no name to offer, and the registry answers instead.
	it('offers no name for a file name that carries none', () => {
		writeLog(`${ALICE.toLowerCase()}.jsonl`, ['01H0000000000000000000000A']);

		expect(loadActorNames(root).has(ALICE)).toBe(false);
	});

	// The realistic upgrade: one person, one old log and one new one. The name
	// must survive, whichever order the directory lists them in.
	it('keeps the name when the same author has an old log and a new one', () => {
		writeLog(`${ALICE.toLowerCase()}.alice.jsonl`, [
			'01H0000000000000000000000A',
		]);
		writeLog(`${ALICE.toLowerCase()}.jsonl`, ['01H0000000000000000000000B']);

		expect(loadActorNames(root).get(ALICE)).toBe('alice');
	});

	// Old-format logs start anew on rename, so one id can be named twice; the
	// log's order decides, never directory order.
	it('settles two names for one author by the log, not the listing', () => {
		writeLog(`${ALICE.toLowerCase()}.alice.jsonl`, [
			'01H0000000000000000000000A',
		]);
		writeLog(`${ALICE.toLowerCase()}.alice-cooper.jsonl`, [
			'01H0000000000000000000000B',
		]);

		expect(loadActorNames(root).get(ALICE)).toBe('alice-cooper');
	});

	it('never offers the file-name placeholder as a name', () => {
		writeLog(`${ALICE.toLowerCase()}.unknown.jsonl`, [
			'01H0000000000000000000000A',
		]);

		expect(loadActorNames(root).has(ALICE)).toBe(false);
	});

	// A name may contain dots — "J. Lampa" sanitizes to `j.-lampa` — and only
	// the first dot is the boundary.
	it('keeps every dot of a dotted name', () => {
		writeLog(`${ALICE.toLowerCase()}.a.b.c-dev.jsonl`, [
			'01H0000000000000000000000A',
		]);

		expect(loadActorNames(root).get(ALICE)).toBe('a.b.c-dev');
	});

	// A pending log is the same actor's, written while a sync held the
	// worktree. Its marker rides on the id segment.
	it('reads through a pending log’s marker', () => {
		writeLog(`${ALICE.toLowerCase()}~pending.alice.jsonl`, [
			'01H0000000000000000000000A',
		]);

		expect(loadActorNames(root).get(ALICE)).toBe('alice');
	});

	it('tells two authors apart', () => {
		writeLog(`${ALICE.toLowerCase()}.alice.jsonl`, [
			'01H0000000000000000000000A',
		]);
		writeLog(`${BOB.toLowerCase()}.bob.jsonl`, ['01H0000000000000000000000B']);

		const names = loadActorNames(root);

		expect(names.get(ALICE)).toBe('alice');
		expect(names.get(BOB)).toBe('bob');
	});

	it('ignores anything that is not a log', () => {
		writeLog(`${ALICE.toLowerCase()}.alice.jsonl`, [
			'01H0000000000000000000000A',
		]);
		fs.writeFileSync(path.join(eventsDir(), 'README.md'), 'not a log\n');
		fs.writeFileSync(path.join(eventsDir(), '.DS_Store'), '\n');

		expect([...loadActorNames(root).keys()]).toEqual([ALICE]);
	});

	// A name is a nicety. A board with no events directory, or one that cannot
	// be listed, must not take a caller down with it.
	it('is empty rather than failing when there is nothing to read', () => {
		expect(loadActorNames(root).size).toBe(0);
		expect(loadActorNames(path.join(root, 'no-such-project')).size).toBe(0);
	});
});

describe('registering the author of a write', () => {
	const writeBy = (userId: string): AppEvent<'edit.title'> => ({
		id: '01H0000000000000000000000A',
		userId,
		action: 'edit.title',
		payload: {id: ROOT, name: 'irrelevant'},
	});

	it('registers this process’s own author under the configured name', () => {
		patchSettingsState({userId: ALICE, userName: 'Alice'});

		const result = ensureContributorCurrent(writeBy(ALICE), materialize);

		expect(isFail(result)).toBe(false);
		expect(getState().contributors[ALICE]?.name).toBe('Alice');
	});

	// An event by somebody else must never pick up this process's name.
	it('never puts our name on somebody else’s event', () => {
		patchSettingsState({userId: ALICE, userName: 'Alice'});

		const result = ensureContributorCurrent(writeBy(BOB), materialize);

		expect(isFail(result)).toBe(false);
		expect(nodeRepo.getContributor(BOB)).toBeUndefined();
	});

	// Nothing to vouch for, so nothing is written. Silent rather than failing:
	// a write is not worth refusing over a name.
	it('registers nobody when this process has no configured name', () => {
		patchSettingsState({userId: ALICE, userName: null});

		const result = ensureContributorCurrent(writeBy(ALICE), materialize);

		expect(isFail(result)).toBe(false);
		expect(nodeRepo.getContributor(ALICE)).toBeUndefined();
	});
});

// A sync stages the actor's old-format log too, which may still hold flushed
// but uncommitted lines.
describe('the logs a sync stages for this actor', () => {
	const current = () => getPersistFileName({userId: ALICE});

	it('is just the current log when there is nothing else', () => {
		writeLog(current(), ['01H0000000000000000000000A']);

		expect(ownEventFileNames(eventsDir(), current())).toEqual([current()]);
	});

	it('includes the log this actor wrote under its old name', () => {
		const legacy = `${ALICE.toLowerCase()}.alice.jsonl`;
		writeLog(legacy, ['01H0000000000000000000000A']);
		writeLog(current(), ['01H0000000000000000000000B']);

		// Current last, so the log being written to now is staged after the one
		// being caught up.
		expect(ownEventFileNames(eventsDir(), current())).toEqual([
			legacy,
			current(),
		]);
	});

	// The one thing it must never do. Staging somebody else's log would commit
	// lines this machine cannot vouch for.
	it('never reaches for another actor’s log', () => {
		writeLog(`${BOB.toLowerCase()}.bob.jsonl`, ['01H0000000000000000000000A']);
		writeLog(`${BOB.toLowerCase()}.jsonl`, ['01H0000000000000000000000B']);
		writeLog(current(), ['01H0000000000000000000000C']);

		expect(ownEventFileNames(eventsDir(), current())).toEqual([current()]);
	});

	// A pending log is deliberately untracked — git must not see it.
	it('leaves the pending log out', () => {
		writeLog(`${ALICE.toLowerCase()}~pending.jsonl`, [
			'01H0000000000000000000000A',
		]);
		writeLog(current(), ['01H0000000000000000000000B']);

		expect(ownEventFileNames(eventsDir(), current())).toEqual([current()]);
	});

	it('still names the current log when the directory is missing', () => {
		expect(ownEventFileNames(path.join(root, 'nowhere'), current())).toEqual([
			current(),
		]);
	});
});

// TypeScript doesn't excess-check a spread, so `{...user}` would put a display
// name on an event and still typecheck.
describe('what an event records about its author', () => {
	// A `User`, the way every write path holds one: the id the event needs and
	// the display name it must not take.
	const configured: User = {userId: ALICE, userName: 'alice'};

	it('is the id, and nothing the configured identity carries beside it', () => {
		expect(actorOf(configured)).toEqual({userId: ALICE});
	});

	// Built from the configured identity, so it is where the slip would land if
	// it came back.
	it('holds for an event a write path builds from the configured identity', () => {
		initWorkspaceState(nodes.workspace(ROOT, 'Identity Root', rank()));

		const event = createRebalanceChildrenEvent(ROOT, configured);

		expect(isFail(event)).toBe(false);
		if (isFail(event)) return;

		expect(Object.keys(event.value).sort()).toEqual([
			'action',
			'id',
			'payload',
			'userId',
		]);
	});
});
