import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ensureContributorCurrent} from '../lib/event/event-materialize-and-persist.js';
import {loadActorNames} from '../lib/event/event-load.js';
import {
	getPersistFileName,
	ownEventFileNames,
} from '../lib/event/event-persist.js';
import {createRebalanceChildrenEvent} from '../lib/event/create-rebalance-children-event.js';
import {actorOf, AppEvent} from '../lib/event/event.model.js';
import {isFail} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {patchSettingsState, User} from '../lib/state/settings.state.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex} from '../lib/utils/rank.js';

// Who an event belongs to, and what that person is called, are two different
// questions with two different answers. The id is structural: it comes off the
// log's file name, where it cannot be forged without writing to somebody
// else's file. The name is the contributor registry's, so a rename shows on
// every line at once.
//
// What is left of the file name's own copy is a fallback for a board written
// before contributors were events. These pin that fallback, since it is the
// part with no other test and the part a future reader is most likely to
// think is dead.

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
	// The shape every board written before ZFZFW9D is full of.
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

	// Before ZFZFW9D a rename started a new log, so one id can be named twice.
	// Directory order says nothing about which came last; the log's own order
	// does, and the answer must not depend on the filesystem.
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

		const result = ensureContributorCurrent(writeBy(ALICE), root);

		expect(isFail(result)).toBe(false);
		expect(getState().contributors[ALICE]?.name).toBe('Alice');
	});

	// The guard that matters. A replayed or synced event authored by somebody
	// else must never pick up this process's name — that would rename them on
	// every board they share.
	it('never puts our name on somebody else’s event', () => {
		patchSettingsState({userId: ALICE, userName: 'Alice'});

		const result = ensureContributorCurrent(writeBy(BOB), root);

		expect(isFail(result)).toBe(false);
		expect(nodeRepo.getContributor(BOB)).toBeUndefined();
	});

	// Nothing to vouch for, so nothing is written. Silent rather than failing:
	// a write is not worth refusing over a name.
	it('registers nobody when this process has no configured name', () => {
		patchSettingsState({userId: ALICE, userName: null});

		const result = ensureContributorCurrent(writeBy(ALICE), root);

		expect(isFail(result)).toBe(false);
		expect(nodeRepo.getContributor(ALICE)).toBeUndefined();
	});
});

// A sync stages the actor's own log by name, and ZFZFW9D moved the name. An
// upgraded machine can still hold lines in its old log that were flushed but
// never committed; staging only the new name would leave them there for good.
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

// The compiler cannot hold this line on its own: TypeScript excess-checks the
// properties written in an object literal, not the ones a spread brings, so
// `{...user}` puts the configured display name back on an event and typechecks
// clean. `stripActor` keeps it off disk either way, which is what makes the
// slip silent — the event a write applies in place would carry a name the same
// event decoded from the log does not.
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
