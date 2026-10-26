import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {
	bootStateFromEventLog,
	createDefaultEvents,
} from '../lib/board/board-boot.js';
import {loadMergedEvents} from '../lib/board/board-log.js';
import {materializeAndPersistAll} from '../lib/board/board-log.js';
import {getPersistFileName, persist} from '../lib/board/board-log.js';
import {flushPendingLogs} from '../lib/event/pending-log.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {isFail} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex, midRank} from '../lib/utils/rank.js';

// The board a write leaves must equal what replaying its log line produces,
// since reads skip the reload after this process's own writes.

// The configured identity: `user` for setup, `actor` (id only) for writes.
const user = {userId: 'u1', userName: 'alice'};
const actor = {userId: user.userId};

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
	const defaults = createDefaultEvents(user);
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

// Folded in first: an append lands in the pending log, where a sync resetting
// the worktree cannot reach it, and this asks what the actor's own log holds.
const persistedIds = (): string[] => {
	flushPendingLogs(rootDir, getPersistFileName(actor));

	return fs
		.readFileSync(
			path.join(rootDir, '.epiq', 'events', getPersistFileName(actor)),
			'utf8',
		)
		.trim()
		.split('\n')
		.map(line => (JSON.parse(line) as {id: [string, string | null]}).id[0]);
};

const loggedIds = (nodeId: string): string[] =>
	(getState().nodes[nodeId]?.log ?? []).map(event => event.id);

describe('an event has one identity', () => {
	// The caller's id is a placeholder; the board must keep the minted one, or
	// its log row can't be found.
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

	// Applying in place equals replaying, asserted whole.
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
