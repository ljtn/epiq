import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {bootStateFromEventLog} from '../lib/board/board-boot.js';
import {
	loadActorNames,
	loadEventActors,
	loadMergedEvents,
} from '../lib/board/board-log.js';
import {isFail} from '../lib/model/result-types.js';
import {getState} from '../lib/state/state.js';

/**
 * A log file name is a read contract, and the only part of the format that
 * cannot be changed by adding.
 *
 * A payload field is additive — a build that does not know it ignores it. A
 * file name is not: every client reads every *other* client's logs, so there is
 * no second name to add one under. `ZFZFW9D` moved the grammar from
 * `<id>.<name>.jsonl` to `<id>.jsonl` on that basis, and the whole of what
 * makes that safe is that both forms keep loading, for good, with the name
 * segment carrying no weight.
 *
 * So this file pins the grammar itself rather than any one reader. It is the
 * test that has to fail if somebody ever tidies away the old form.
 */

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';

const line = (id: string, ref: string | null, payload: object): string =>
	JSON.stringify({v: 1, id: [id, ref], ...payload});

const workspace = (id: string) =>
	line(id, null, {
		'init.workspace': {id: 'ws1', name: 'Workspace', rank: 'a0'},
	});

const retitle = (id: string, ref: string, name: string) =>
	line(id, ref, {'edit.title': {id: 'ws1', name}});

const A = '01H0000000000000000000000A';
const B = '01H0000000000000000000000B';
const C = '01H0000000000000000000000C';

/** An events directory holding exactly the log files given. */
const seed = (logs: Record<string, string[]>): string => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-old-names-'));
	const eventsDir = path.join(root, '.epiq', 'events');
	fs.mkdirSync(eventsDir, {recursive: true});

	for (const [fileName, lines] of Object.entries(logs)) {
		fs.writeFileSync(path.join(eventsDir, fileName), lines.join('\n') + '\n');
	}

	return root;
};

const actorIds = (root: string): string[] => {
	const actors = loadEventActors(root);
	if (isFail(actors)) throw new Error(actors.message);

	return [...new Set(actors.value.map(actor => actor.userId))].sort();
};

const eventIds = (root: string): string[] => {
	const events = loadMergedEvents(root);
	if (isFail(events)) throw new Error(events.message);

	return events.value.map(event => event.id);
};

const authorOf = (root: string, eventId: string): string | undefined => {
	const events = loadMergedEvents(root);
	if (isFail(events)) throw new Error(events.message);

	return events.value.find(event => event.id === eventId)?.userId;
};

describe('a log written before ZFZFW9D', () => {
	it('still loads its events', () => {
		const root = seed({
			[`${ID.toLowerCase()}.alice.jsonl`]: [workspace(A), retitle(B, A, 'Old')],
		});

		expect(eventIds(root)).toEqual([A, B]);
	});

	it('is attributed to the id segment, not to the name beside it', () => {
		const root = seed({
			[`${ID.toLowerCase()}.alice.jsonl`]: [workspace(A)],
		});

		expect(authorOf(root, A)).toBe(ID);
	});

	// The file name is lowercased on the way to disk and a contributor record
	// keeps the `ulid()` casing, so a lowercased id read back as-is would split
	// one person in two — an assignment against one of the halves resolving to
	// nobody.
	it('reads back under the casing a contributor record uses', () => {
		const root = seed({[`${ID.toLowerCase()}.alice.jsonl`]: [workspace(A)]});

		expect(actorIds(root)).toEqual([ID]);
	});

	// `sanitizeFilePart` leaves dots alone, so "J. Lampa" reaches disk as
	// `j.-lampa` and the name segment holds any number of them. Only the first
	// separator divides id from name.
	it('survives a name carrying dots of its own', () => {
		const root = seed({[`${ID.toLowerCase()}.j.-lampa.jsonl`]: [workspace(A)]});

		expect(actorIds(root)).toEqual([ID]);
		expect(loadActorNames(root).get(ID)).toBe('j.-lampa');
	});

	it('offers its name only as the file name fallback', () => {
		const root = seed({[`${ID.toLowerCase()}.alice.jsonl`]: [workspace(A)]});

		expect(loadActorNames(root).get(ID)).toBe('alice');
	});
});

describe('a log written since ZFZFW9D', () => {
	it('still loads its events', () => {
		const root = seed({
			[`${ID.toLowerCase()}.jsonl`]: [workspace(A), retitle(B, A, 'New')],
		});

		expect(eventIds(root)).toEqual([A, B]);
		expect(authorOf(root, A)).toBe(ID);
	});

	// The extension comes off before the split, so there is no separator left to
	// find. Reading it the other way round would name every modern author
	// `jsonl`.
	it('is not read as an author called jsonl', () => {
		const root = seed({[`${ID.toLowerCase()}.jsonl`]: [workspace(A)]});

		expect(loadActorNames(root).has(ID)).toBe(false);
		expect([...loadActorNames(root).values()]).not.toContain('jsonl');
	});
});

describe('the two grammars side by side', () => {
	// What a machine holds across the upgrade, and what a board holds forever
	// once one person has upgraded and another has not.
	it('are one author when they carry one id', () => {
		const root = seed({
			[`${ID.toLowerCase()}.alice.jsonl`]: [workspace(A)],
			[`${ID.toLowerCase()}.jsonl`]: [retitle(B, A, 'After the upgrade')],
		});

		expect(actorIds(root)).toEqual([ID]);
		expect(eventIds(root)).toEqual([A, B]);
		expect(authorOf(root, B)).toBe(ID);
	});

	it('are two authors when they carry two ids', () => {
		const root = seed({
			[`${ID.toLowerCase()}.alice.jsonl`]: [workspace(A)],
			[`${OTHER_ID.toLowerCase()}.jsonl`]: [retitle(B, A, 'From the other')],
		});

		expect(actorIds(root)).toEqual([ID, OTHER_ID].sort());
		expect(authorOf(root, A)).toBe(ID);
		expect(authorOf(root, B)).toBe(OTHER_ID);
	});

	// The strongest form of "the name segment carries no weight": the same
	// events under either name derive the same board. Anything the name reached
	// would show up here as a difference.
	it('derive the same board from the same events', () => {
		const lines = [
			workspace(A),
			retitle(B, A, 'Renamed'),
			retitle(C, B, 'Again'),
		];

		const boardFrom = (fileName: string) => {
			const events = loadMergedEvents(seed({[fileName]: lines}));
			if (isFail(events)) throw new Error(events.message);

			const booted = bootStateFromEventLog(events.value);
			if (isFail(booted)) throw new Error(booted.message);

			const {nodes, contributors, tags} = getState();
			return JSON.stringify({nodes, contributors, tags});
		};

		expect(boardFrom(`${ID.toLowerCase()}.jsonl`)).toBe(
			boardFrom(`${ID.toLowerCase()}.alice.jsonl`),
		);
	});
});

describe('a pending log beside either grammar', () => {
	// The marker rides on the id segment, so it comes off before the split. A
	// line is not attributed differently for having been written while a sync
	// held the worktree — under either naming.
	it('belongs to the same author as the log it will fold into', () => {
		const root = seed({
			[`${ID.toLowerCase()}~pending.alice.jsonl`]: [workspace(A)],
			[`${OTHER_ID.toLowerCase()}~pending.jsonl`]: [retitle(B, A, 'Pending')],
		});

		expect(authorOf(root, A)).toBe(ID);
		expect(authorOf(root, B)).toBe(OTHER_ID);
	});
});
