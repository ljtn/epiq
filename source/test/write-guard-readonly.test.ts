import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {materializeAll} from '../lib/event/event-materialize.js';
import {AppEvent} from '../lib/event/event.model.js';
import {isFail} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState, patchState} from '../lib/state/state.js';
import {midRank} from '../lib/utils/rank.js';

// `readOnly` is set by a time-travel checkout, and enforced on the write path
// itself so every caller is covered — the GUI and the MCP tools reach the event
// log through epiq-api without passing the TUI's command layer.

const IDS = {
	root: '01H00000000000000000000000',
	workspace: '01H00000000000000000000001',
	board: '01H00000000000000000000002',
	swimlane: '01H00000000000000000000003',
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
	rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-write-guard-'));

	initWorkspaceState(nodes.workspace(IDS.root, 'Test Root', rank()));
	materializeAll([
		{
			id: eventId(),
			action: 'add.board',
			payload: {
				id: IDS.board,
				name: 'Board',
				parent: IDS.root,
				rank: rank(),
			},
			...actor,
		},
	] as const);
});

afterEach(() => {
	fs.rmSync(rootDir, {recursive: true, force: true});
});

describe('materializeAndPersistAll', () => {
	it('refuses to write while the state is a historical checkout', () => {
		patchState({readOnly: true});

		const result = materializeAndPersistAll(
			[addSwimlane(IDS.swimlane, 'Written while scrubbed')],
			rootDir,
		);

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain('time travelling');
		// Not materialized either: a refused write must leave no trace in the
		// state the reader is looking at.
		expect(nodeRepo.getNode(IDS.swimlane)).toBeUndefined();
	});

	it('writes normally once the checkout is released', () => {
		patchState({readOnly: true});
		expect(
			isFail(
				materializeAndPersistAll([addSwimlane(IDS.swimlane, 'A')], rootDir),
			),
		).toBe(true);

		patchState({readOnly: false});

		const result = materializeAndPersistAll(
			[addSwimlane(IDS.swimlane, 'A')],
			rootDir,
		);

		expect(isFail(result)).toBe(false);
		expect(nodeRepo.getNode(IDS.swimlane)?.title).toBe('A');
	});
});
