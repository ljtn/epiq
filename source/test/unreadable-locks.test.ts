import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	bootStateFromEventLog,
	relockUnreadableEvents,
} from '../lib/event/event-boot.js';
import {loadMergedEventsWithUnreadable} from '../lib/event/event-load.js';
import {materializeAll} from '../lib/event/event-materialize.js';
import {isFail} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {nodes} from '../lib/state/node-builder.js';
import {
	getState,
	initWorkspaceState,
	patchState,
	resetState,
} from '../lib/state/state.js';
import {bigIntToHex} from '../lib/utils/rank.js';

// A lock is derived at load and never persisted, so every one of these asserts
// on in-memory state only; the fixture logs on disk are never rewritten.

const WS = '01H0000000000000000000WS01';
const BOARD = '01H0000000000000000000BD01';
const SWIMLANE = '01H0000000000000000000SW01';

const eid = (suffix: string) =>
	`01H00000000000000000${suffix.padStart(6, '0')}`;

const base = [
	{
		v: 1,
		id: [eid('A'), null],
		'init.workspace': {id: WS, name: 'W', rank: 'a0'},
	},
	{
		v: 1,
		id: [eid('B'), eid('A')],
		'add.board': {id: BOARD, name: 'Board', parent: WS, rank: 'a0'},
	},
	{
		v: 1,
		id: [eid('C'), eid('B')],
		'add.swimlane': {id: SWIMLANE, name: 'Todo', parent: BOARD, rank: 'a0'},
	},
];

let root = '';

const write = (lines: unknown[]) => {
	const dir = path.join(root, '.epiq', 'events');
	fs.mkdirSync(dir, {recursive: true});
	fs.writeFileSync(
		path.join(dir, '01H0000000000000000000000F.alice.jsonl'),
		lines.map(line => JSON.stringify(line)).join('\n') + '\n',
	);
};

const loadAndBoot = () => {
	const loaded = loadMergedEventsWithUnreadable(root);
	if (isFail(loaded)) throw new Error(loaded.message);

	const booted = bootStateFromEventLog(
		loaded.value.events,
		loaded.value.unreadable,
	);
	if (isFail(booted)) throw new Error(booted.message);

	return loaded.value;
};

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-unreadable-'));

	const rankResult = bigIntToHex(1n);
	if (isFail(rankResult)) throw new Error(rankResult.message);

	initWorkspaceState(
		nodes.workspace('test-root', 'Test Root', rankResult.value),
	);
});

afterEach(() => {
	fs.rmSync(root, {recursive: true, force: true});
});

describe('locking history this build cannot read', () => {
	it('locks the node an unreadable event names', () => {
		write([
			...base,
			{v: 2, id: [eid('D'), eid('C')], 'edit.title': {id: BOARD, name: 'x'}},
		]);

		loadAndBoot();

		expect(getState().nodes[BOARD]?.readonly).toBe(true);
		expect(getState().nodes[SWIMLANE]?.readonly).toBe(false);
		// Scoped, so the rest of the board stays writable.
		expect(getState().readOnly).toBe(false);
	});

	// The unreadable event is what *created* the node, so there is no node to
	// lock and nothing bounds what else it touched.
	it('falls back to a board-wide lock when the named node was never materialized', () => {
		write([
			...base,
			{
				v: 2,
				id: [eid('D'), eid('C')],
				'add.issue': {
					id: 'ticket-from-the-future',
					name: 'ghost',
					parent: SWIMLANE,
				},
			},
		]);

		loadAndBoot();

		expect(getState().readOnly).toBe(true);
		expect(getState().readOnlyReason).toContain('Upgrade epiq');
	});

	// A tag id is not a node id, so `markNodeUnreadable` cannot place it either.
	it('falls back to a board-wide lock when the named id is not a node', () => {
		write([
			...base,
			{
				v: 2,
				id: [eid('D'), eid('C')],
				'create.tag': {id: 'tag-1', name: 'urgent'},
			},
		]);

		loadAndBoot();

		expect(getState().readOnly).toBe(true);
	});

	// More than one payload key means we cannot tell which is the action, so the
	// id under any of them is a guess.
	it('falls back to a board-wide lock when the payload shape is ambiguous', () => {
		write([
			...base,
			{
				v: 2,
				id: [eid('D'), eid('C')],
				'edit.title': {id: BOARD, name: 'x'},
				'future.extra': {id: SWIMLANE},
			},
		]);

		loadAndBoot();

		expect(getState().readOnly).toBe(true);
		expect(getState().nodes[BOARD]?.readonly).toBe(false);
	});

	it('leaves everything writable when the whole log is readable', () => {
		write(base);
		loadAndBoot();

		expect(getState().readOnly).toBe(false);
		expect(getState().readOnlyReason).toBeUndefined();
		expect(getState().nodes[BOARD]?.readonly).toBe(false);
	});
});

// `:peek now`, `returnToLive` and the end of a replay all rebuild the node graph
// without going through `bootStateFromEventLog`, then reopen writes.
describe('re-locking after a return to live', () => {
	const returnToLiveLike = (events: Parameters<typeof materializeAll>[0]) => {
		const reset = resetState();
		if (isFail(reset)) throw new Error(reset.message);

		const failures = materializeAll(events).filter(isFail);
		expect(failures).toEqual([]);

		patchState({
			readOnly: false,
			readOnlyReason: undefined,
			timeMode: 'live',
			unappliedEvents: [],
			replay: null,
		});
	};

	it('restores a per-node lock that the rebuild wiped', () => {
		write([
			...base,
			{v: 2, id: [eid('D'), eid('C')], 'edit.title': {id: BOARD, name: 'x'}},
		]);

		const {events} = loadAndBoot();
		expect(getState().nodes[BOARD]?.readonly).toBe(true);

		returnToLiveLike(events);
		expect(getState().nodes[BOARD]?.readonly).toBe(false);

		relockUnreadableEvents();
		expect(getState().nodes[BOARD]?.readonly).toBe(true);
	});

	it('restores a board-wide lock that the rebuild wiped', () => {
		write([
			...base,
			{v: 2, id: [eid('D'), eid('C')], 'create.tag': {id: 'tag-1', name: 'x'}},
		]);

		const {events} = loadAndBoot();
		expect(getState().readOnly).toBe(true);

		returnToLiveLike(events);
		expect(getState().readOnly).toBe(false);

		relockUnreadableEvents();
		expect(getState().readOnly).toBe(true);
	});

	it('does not lock a board whose log is fully readable', () => {
		write(base);

		const {events} = loadAndBoot();
		returnToLiveLike(events);
		relockUnreadableEvents();

		expect(getState().readOnly).toBe(false);
		expect(getState().nodes[BOARD]?.readonly).toBe(false);
	});
});

describe('a derived lock explains itself', () => {
	it('gives the reason instead of the generic refusal', () => {
		write([
			...base,
			{v: 2, id: [eid('D'), eid('C')], 'edit.title': {id: SWIMLANE, name: 'x'}},
		]);

		loadAndBoot();

		const result = nodeRepo.renameNode(SWIMLANE, 'Renamed');

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('newer epiq');
		expect(result.message).not.toBe('Cannot rename readonly node');
	});

	// The Closed board and swimlane are locked by a `lock.node` event, which
	// carries no reason of its own.
	it('keeps the generic refusal for a node locked by the log itself', () => {
		write(base);
		loadAndBoot();

		const locked = nodeRepo.lockNode(BOARD);
		expect(isFail(locked)).toBe(false);

		const result = nodeRepo.renameNode(BOARD, 'Renamed');

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toBe('Cannot rename readonly node');
	});
});
