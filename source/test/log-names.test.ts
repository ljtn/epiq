import {describe, expect, it} from 'vitest';
import {ulid} from 'ulid';
import {bootStateFromEventLog} from '../lib/event/event-boot.js';
import {AppEvent} from '../lib/event/event.model.js';
import {projectLogNames} from '../lib/event/log-names.js';
import {isFail} from '../lib/model/result-types.js';
import {getState} from '../lib/state/state.js';

// `projectLogNames` says what the board's registries would say, without booting
// a board to ask. That is two implementations of one rule, which is how the
// timeline came to be showing a name a rename had replaced and a name a
// tombstone had cleared. These pin the second against the first.

const WORKSPACE = '01J000000000000000000WSPC';
const BOARD = '01J0000000000000000000BRD';
const LANE = '01J000000000000000000LANE';
const ALICE = '01J00000000000000000ALICE';
const BOB = '01J0000000000000000000BOB';
const TAG = '01J0000000000000000000TAG';
const NAMELESS = '01J00000000000000NAMELESS';

let seq = 0;
const at = <A extends AppEvent['action']>(
	action: A,
	payload: Extract<AppEvent, {action: A}>['payload'],
): AppEvent =>
	({
		id: ulid(1_700_000_000_000 + seq++),
		action,
		payload,
		userId: ALICE,
	} as AppEvent);

// Enough of a board to boot, then every naming event there is.
const log = (): AppEvent[] => [
	at('init.workspace', {id: WORKSPACE, name: 'Workspace', rank: 'a0'}),
	at('add.board', {id: BOARD, name: 'Board', parent: WORKSPACE, rank: 'a0'}),
	at('add.swimlane', {id: LANE, name: 'Backlog', parent: BOARD, rank: 'a0'}),

	at('create.contributor', {id: ALICE, name: 'alice'}),
	at('rename.contributor', {id: ALICE, name: 'Alice Cooper'}),

	at('create.contributor', {id: BOB, name: 'bob'}),
	at('tombstone.contributor', {id: BOB}),
	// Refused on a tombstoned record on both sides, or a rename would quietly
	// undo a removal.
	at('rename.contributor', {id: BOB, name: 'bob again'}),

	at('create.tag', {id: TAG, name: 'bug'}),
	at('tombstone.tag', {id: TAG}),
	at('restore.tag', {id: TAG, name: 'defect'}),

	// `name` is any string in the payload schema, so this is a real record the
	// registry will go on to rename — and a projection reading "exists" off the
	// name would refuse that rename.
	at('create.contributor', {id: NAMELESS, name: ''}),
	at('rename.contributor', {id: NAMELESS, name: 'Found A Name'}),

	at('edit.title', {id: LANE, name: 'Icebox'}),
];

const booted = () => {
	const result = bootStateFromEventLog(log());
	if (isFail(result)) throw new Error(result.message);

	return getState();
};

describe('names projected from the log', () => {
	it('agrees with the contributor registry a boot builds', () => {
		const projected = projectLogNames(log()).byId;
		const registry = new Map(
			Object.values(booted().contributors).map(({id, name}) => [id, name]),
		);

		for (const [id, name] of registry) {
			expect(projected.get(id), `contributor ${id}`).toBe(name);
		}

		expect(registry.size).toBeGreaterThan(0);
	});

	it('agrees with the tag registry a boot builds', () => {
		const projected = projectLogNames(log()).byId;

		for (const tag of Object.values(booted().tags)) {
			expect(projected.get(tag.id), `tag ${tag.id}`).toBe(tag.name);
		}
	});

	// The two cases 2BPYNWE was filed for, spelled out rather than left to the
	// sweep above: these are what the timeline used to get wrong.
	it('carries a rename', () => {
		expect(projectLogNames(log()).byId.get(ALICE)).toBe('Alice Cooper');
	});

	it('clears a tombstoned name, and keeps it cleared through a rename', () => {
		expect(projectLogNames(log()).byId.get(BOB)).toBe('removed');
	});

	it('renames a contributor created without a name', () => {
		expect(projectLogNames(log()).byId.get(NAMELESS)).toBe('Found A Name');
	});

	it('carries a tag restored under a new name', () => {
		expect(projectLogNames(log()).byId.get(TAG)).toBe('defect');
	});

	it('renames a lane, and names it in the lane index alone', () => {
		const {byId, lanes} = projectLogNames(log());

		expect(lanes).toEqual({[LANE]: 'Icebox'});
		expect(byId.get(BOARD)).toBe('Board');
	});

	it('names nothing an empty log never mentioned', () => {
		expect(projectLogNames([]).byId.size).toBe(0);
	});
});
