import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
	bootStateFromEventLog,
	createDefaultEvents,
} from '../lib/event/event-boot.js';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {getPersistFileName, persist} from '../lib/event/event-persist.js';
import {AppEvent} from '../lib/event/event.model.js';
import {isFail} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex, midRank} from '../lib/utils/rank.js';

// One question: is the board a write leaves behind the board that replaying
// that write's log line produces?
//
// It has to be, and not only for tidiness. Reading the board skips the reload
// when this process is the one that moved the log — the whole reason a write is
// a fifth of a second rather than seconds — and that skip is only sound if
// applying an event in place lands where replaying it would. When it did not,
// nothing said so: the board looked right, and only the things addressed by
// event id quietly stopped matching, until something else forced a reload.

const actor = {userId: 'u1', userName: 'alice'};

let seq = 0;
const placeholderId = () =>
	`01H00000000000000000${String(++seq).padStart(6, '0')}`;

const rank = () => {
	const result = midRank();
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

let rootDir = '';
let boardId = '';

const startBoard = () => {
	const rootRank = bigIntToHex(1n);
	if (isFail(rootRank)) throw new Error(rootRank.message);

	initWorkspaceState(nodes.workspace('test-root', 'Test Root', rootRank.value));
};

// The project as `init` leaves it: the default events on disk and a board
// booted from them, so the live writes below start where a real one does.
const initProject = () => {
	const defaults = createDefaultEvents(actor);
	if (isFail(defaults)) throw new Error(defaults.message);

	for (const event of defaults.value) {
		const written = persist({event, rootDir});
		if (isFail(written)) throw new Error(written.message);
	}

	const board = defaults.value.find(event => event.action === 'add.board');
	if (!board) throw new Error('Expected a default board');
	boardId = (board.payload as {id: string}).id;

	reboot();
};

const reboot = () => {
	const events = loadMergedEvents(rootDir);
	if (isFail(events)) throw new Error(events.message);

	startBoard();

	const booted = bootStateFromEventLog(events.value);
	if (isFail(booted)) throw new Error(booted.message);
};

const addSwimlane = (id: string, name: string): AppEvent<'add.swimlane'> => ({
	id: placeholderId(),
	action: 'add.swimlane',
	payload: {id, name, parent: boardId, rank: rank()},
	...actor,
});

beforeEach(() => {
	seq = 0;
	rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-identity-'));
	fs.mkdirSync(path.join(rootDir, '.epiq', 'events'), {recursive: true});

	startBoard();
	initProject();
});

afterEach(() => {
	fs.rmSync(rootDir, {recursive: true, force: true});
});

const persistedIds = (): string[] =>
	fs
		.readFileSync(
			path.join(rootDir, '.epiq', 'events', getPersistFileName(actor)),
			'utf8',
		)
		.trim()
		.split('\n')
		.map(line => (JSON.parse(line) as {id: [string, string | null]}).id[0]);

const loggedIds = (nodeId: string): string[] =>
	(getState().nodes[nodeId]?.log ?? []).map(event => event.id);

describe('an event has one identity', () => {
	// The id a caller builds an event with is a placeholder — the real one is
	// minted against the edge. So the board must not keep the placeholder: a log
	// row carrying an id no line in the file has cannot be found, checked out, or
	// pointed at from the chart.
	it('is the log line’s, not the one the caller proposed', () => {
		const proposed = placeholderId();

		const result = materializeAndPersistAll(
			[{...addSwimlane('01H00000000000000000100001', 'A'), id: proposed}],
			rootDir,
		);
		expect(isFail(result)).toBe(false);

		const written = persistedIds();

		expect(loggedIds('01H00000000000000000100001')).toEqual([written.at(-1)]);
		expect(written).not.toContain(proposed);
	});

	it('holds for every event of a batch, in the order they were written', () => {
		const before = persistedIds().length;

		const result = materializeAndPersistAll(
			[
				addSwimlane('01H00000000000000000100001', 'A'),
				addSwimlane('01H00000000000000000100002', 'B'),
				addSwimlane('01H00000000000000000100003', 'C'),
			],
			rootDir,
		);
		expect(isFail(result)).toBe(false);

		expect([
			...loggedIds('01H00000000000000000100001'),
			...loggedIds('01H00000000000000000100002'),
			...loggedIds('01H00000000000000000100003'),
		]).toEqual(persistedIds().slice(before));
	});

	// The invariant the skipped reload rests on, asserted whole rather than
	// through the ids alone: any future divergence between applying in place and
	// replaying shows up here.
	it('leaves the board a replay of the log produces', () => {
		const result = materializeAndPersistAll(
			[
				addSwimlane('01H00000000000000000100001', 'A'),
				addSwimlane('01H00000000000000000100002', 'B'),
			],
			rootDir,
		);
		expect(isFail(result)).toBe(false);

		const written = structuredClone(getState().nodes);

		reboot();

		expect(getState().nodes).toEqual(written);
	});
});
