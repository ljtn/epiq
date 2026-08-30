import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {getPersistFileName} from '../lib/event/event-persist.js';
import {AppEvent} from '../lib/event/event.model.js';
import {isFail} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';

// A batch resolves the edge once and advances it locally per persist, rather
// than re-reading the whole log for every event.

const IDS = {
	root: '01H00000000000000000000000',
	board: '01H00000000000000000000002',
} as const;

const actor = {userId: 'u1', userName: 'alice'};

let seq = 0;
const eventId = () => `01H00000000000000000${String(++seq).padStart(6, '0')}`;

const rank = () => {
	const result = midRank();
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const addSwimlane = (id: string, name: string): AppEvent<'add.swimlane'> => ({
	id: eventId(),
	action: 'add.swimlane',
	payload: {id, name, parent: IDS.board, rank: rank()},
	...actor,
});

let rootDir = '';

beforeEach(() => {
	rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-batch-'));
	fs.mkdirSync(path.join(rootDir, '.epiq'), {recursive: true});

	initWorkspaceState(nodes.workspace(IDS.root, 'Test Root', rank()));
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(rootDir, {recursive: true, force: true});
});

const ownLogLines = (): Array<{id: [string, string | null]}> =>
	fs
		.readFileSync(
			path.join(
				rootDir,
				'.epiq',
				'events',
				getPersistFileName({userId: 'u1', userName: 'alice'}),
			),
			'utf8',
		)
		.trim()
		.split('\n')
		.map(line => JSON.parse(line));

describe('materializeAndPersistAll edge threading', () => {
	it('reads the log once per batch, not once per event', () => {
		// The dir must exist or the loads short-circuit before readdir.
		fs.mkdirSync(path.join(rootDir, '.epiq', 'events'), {recursive: true});

		const readdirSpy = vi.spyOn(fs, 'readdirSync');

		const result = materializeAndPersistAll(
			[
				addSwimlane('01H00000000000000000100001', 'A'),
				addSwimlane('01H00000000000000000100002', 'B'),
				addSwimlane('01H00000000000000000100003', 'C'),
			],
			rootDir,
		);

		expect(isFail(result)).toBe(false);

		const eventDirReads = readdirSpy.mock.calls.filter(([dir]) =>
			String(dir).endsWith(path.join('.epiq', 'events')),
		);
		expect(eventDirReads).toHaveLength(1);
	});

	it('chains every persisted event to its predecessor, starting at the loaded edge', () => {
		// Another actor's log provides the edge the batch must anchor to.
		const eventsDir = path.join(rootDir, '.epiq', 'events');
		fs.mkdirSync(eventsDir, {recursive: true});
		const existingEdge = '01H00000000000000000000099';
		fs.writeFileSync(
			path.join(eventsDir, '01ARZ3NDEKTSV4RRFFQ69G5FAV.mallory.jsonl'),
			JSON.stringify({
				v: 1,
				id: [existingEdge, null],
				'init.workspace': {id: 'w', name: 'W'},
			}) + '\n',
		);

		const result = materializeAndPersistAll(
			[
				addSwimlane('01H00000000000000000100001', 'A'),
				addSwimlane('01H00000000000000000100002', 'B'),
			],
			rootDir,
		);

		expect(isFail(result)).toBe(false);

		// create.contributor is written first, then the two batch events; each
		// line refs the id minted just before it.
		const lines = ownLogLines();
		expect(lines).toHaveLength(3);
		expect(lines[0]?.id[1]).toBe(existingEdge);
		expect(lines[1]?.id[1]).toBe(lines[0]?.id[0]);
		expect(lines[2]?.id[1]).toBe(lines[1]?.id[0]);
	});

	it('does not advance the cursor past an event that was never persisted', () => {
		const editMissingNode: AppEvent<'edit.title'> = {
			id: eventId(),
			action: 'edit.title',
			payload: {id: '01H00000000000000000999999', name: 'nope'},
			...actor,
		};

		materializeAndPersistAll(
			[
				addSwimlane('01H00000000000000000100001', 'A'),
				editMissingNode,
				addSwimlane('01H00000000000000000100003', 'C'),
			],
			rootDir,
		);

		// contributor, A, C — the skipped edit writes nothing, and C must chain
		// to A, not to an id that never reached disk.
		const lines = ownLogLines();
		expect(lines).toHaveLength(3);
		expect(lines[2]?.id[1]).toBe(lines[1]?.id[0]);
	});
});
