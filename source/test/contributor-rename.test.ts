import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AppEvent} from '../lib/event/event.model.js';

const persisted: AppEvent[] = [];

let minted = 0;

vi.mock('../lib/event/event-persist.js', () => ({
	persist: vi.fn(({event}: {event: AppEvent}) => {
		persisted.push(event);
		return {status: 'success', message: 'mocked persist', value: null};
	}),
	// The write path identifies an event before applying it, so the board and
	// the log agree on what it is called.
	mintEventId: vi.fn(() => ({
		status: 'success',
		message: 'mocked mint',
		value: [
			`01H0000000000000000MINT${String(++minted).padStart(2, '0')}`,
			null,
		],
	})),
	resolveEpiqRoot: vi.fn((dir?: string) => dir ?? process.cwd()),
}));

import {ensureContributorCurrent} from '../lib/event/event-materialize-and-persist.js';
import {isFail} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex} from '../lib/utils/rank.js';

const ROOT = 'test-root';

const rank = () => {
	const result = bigIntToHex(1n);
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

// Stands in for any ordinary write. Only the actor on it matters — this is
// the hook `materializeAndPersistAll` runs before the write itself.
const writeAs = (userId: string, userName: string) =>
	ensureContributorCurrent(
		{
			id: `event-${persisted.length}`,
			userId,
			userName,
			action: 'edit.title',
			payload: {id: ROOT, name: 'irrelevant'},
		} satisfies AppEvent<'edit.title'>,
		'/tmp/unused',
	);

const actorEvents = () =>
	persisted.filter(
		event =>
			event.action === 'create.contributor' ||
			event.action === 'rename.contributor',
	);

beforeEach(() => {
	persisted.length = 0;
	initWorkspaceState(nodes.workspace(ROOT, 'Test Root', rank()));
});

describe('contributor rename', () => {
	it('registers an unknown author on their first write', () => {
		expect(isFail(writeAs('u1', 'Bob Smith'))).toBe(false);

		expect(actorEvents().map(e => [e.action, e.payload])).toEqual([
			['create.contributor', {id: 'u1', name: 'Bob Smith'}],
		]);
		expect(getState().contributors['u1']?.name).toBe('Bob Smith');
	});

	// The whole point: the log file name is sanitized, so a new display name
	// only reaches anyone else as an event.
	it('emits a rename when the author writes under a new name', () => {
		writeAs('u1', 'Bob Smith');
		persisted.length = 0;

		expect(isFail(writeAs('u1', 'Rob Smith'))).toBe(false);

		expect(actorEvents().map(e => [e.action, e.payload])).toEqual([
			['rename.contributor', {id: 'u1', name: 'Rob Smith'}],
		]);
		expect(getState().contributors['u1']?.name).toBe('Rob Smith');
	});

	it('stays quiet when the name has not changed', () => {
		writeAs('u1', 'Bob Smith');
		persisted.length = 0;

		writeAs('u1', 'Bob Smith');

		expect(actorEvents()).toEqual([]);
	});

	// A name that survives sanitizing unchanged used to be indistinguishable
	// from no rename at all.
	it('emits a rename the old file-name comparison could not detect', () => {
		writeAs('u1', '李明');
		persisted.length = 0;

		writeAs('u1', '王芳');

		expect(actorEvents().map(e => [e.action, e.payload])).toEqual([
			['rename.contributor', {id: 'u1', name: '王芳'}],
		]);
		expect(getState().contributors['u1']?.name).toBe('王芳');
	});

	it('never renames a removed contributor back into existence', () => {
		writeAs('u1', 'Bob Smith');
		const tombstoned = nodeRepo.tombstoneContributor('u1');
		if (isFail(tombstoned)) throw new Error(tombstoned.message);
		persisted.length = 0;

		expect(isFail(writeAs('u1', 'Bob Smith Again'))).toBe(false);

		expect(actorEvents()).toEqual([]);
		expect(getState().contributors['u1']?.name).toBe('removed');
	});
});

describe('renameContributor', () => {
	it('refuses a tombstoned record', () => {
		writeAs('u1', 'Bob Smith');
		const tombstoned = nodeRepo.tombstoneContributor('u1');
		if (isFail(tombstoned)) throw new Error(tombstoned.message);

		const result = nodeRepo.renameContributor('u1', 'Bob Smith');

		expect(isFail(result)).toBe(true);
		expect(getState().contributors['u1']?.name).toBe('removed');
	});

	it('refuses an id the registry has never seen', () => {
		expect(isFail(nodeRepo.renameContributor('nobody', 'Ghost'))).toBe(true);
	});
});
