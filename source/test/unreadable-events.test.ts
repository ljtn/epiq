import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {bootStateFromEventLog} from '../lib/event/event-boot.js';
import {loadMergedEventsWithUnreadable} from '../lib/event/event-load.js';
import {isFail} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex} from '../lib/utils/rank.js';

// An unreadable event is detected at load and reported, never enforced, so
// every assertion here is on in-memory state; the fixture logs on disk are
// only ever read.

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

describe('history this build cannot read', () => {
	it('reports an unreadable schema version without locking anything', () => {
		write([
			...base,
			{v: 2, id: [eid('D'), eid('C')], 'edit.title': {id: BOARD, name: 'x'}},
		]);

		const loaded = loadAndBoot();

		expect(loaded.unreadable.map(entry => entry.reason)).toEqual([
			'unsupported-schema-version',
		]);
		expect(getState().readOnly).toBe(false);
		expect(getState().readOnlyReason).toBeUndefined();
		expect(getState().nodes[BOARD]?.readonly).toBe(false);
		expect(getState().nodes[SWIMLANE]?.readonly).toBe(false);
	});

	// Skipping one event must not cost the events around it.
	it('applies the readable events either side of one it cannot read', () => {
		write([
			...base,
			{v: 2, id: [eid('D'), eid('C')], 'edit.title': {id: BOARD, name: 'x'}},
			{
				v: 1,
				id: [eid('E'), eid('D')],
				'edit.title': {id: SWIMLANE, name: 'Renamed'},
			},
		]);

		loadAndBoot();

		expect(getState().nodes[BOARD]?.title).toBe('Board');
		expect(getState().nodes[SWIMLANE]?.title).toBe('Renamed');
	});

	// The incident this replaced: an action from a build that never shipped, so
	// no upgrade will ever understand it and a lock could never lift.
	it('skips an action no build will ever know and stays writable', () => {
		write([
			...base,
			{
				v: 1,
				id: [eid('D'), eid('C')],
				'redact.contributor': {id: '01H0000000000000000000CB01'},
			},
		]);

		const loaded = loadAndBoot();

		expect(loaded.unreadable.map(entry => entry.detail)).toEqual([
			'redact.contributor',
		]);
		expect(getState().readOnly).toBe(false);
		expect(getState().nodes[BOARD]?.readonly).toBe(false);
	});

	it('reports nothing when the whole log is readable', () => {
		write(base);

		const loaded = loadAndBoot();

		expect(loaded.unreadable).toEqual([]);
		expect(getState().readOnly).toBe(false);
		expect(getState().nodes[BOARD]?.readonly).toBe(false);
	});
});
