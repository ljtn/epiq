import {beforeAll, describe, expect, it} from 'vitest';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materializeAll} from '../lib/board/board-log.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {hasAuthoredEvents} from '../lib/utils/contributor.utils.js';
import {setVirtualNodesEnabled} from '../lib/virtual-nodes/virtual-nodes.js';
import {rank, unwrap} from './helpers/random-board-log.js';

let seq = 0;
const by = (userId: string, action: string, payload: object): AppEvent =>
	({
		id: `01H00000000000000000${String(++seq).padStart(6, '0')}`,
		action,
		payload,
		userId,
	} as AppEvent);

const apply = (events: AppEvent[]) => {
	for (const result of materializeAll(events)) unwrap(result);
};

beforeAll(() => setVirtualNodesEnabled(false));

describe('hasAuthoredEvents', () => {
	it('is true for anyone who wrote an applied event, and no one else', () => {
		unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));
		apply([
			by('alice', 'add.board', {
				id: 'board',
				name: 'B',
				parent: 'root',
				rank: rank(),
			}),
		]);

		expect(hasAuthoredEvents('alice')).toBe(true);
		expect(hasAuthoredEvents('bob')).toBe(false);

		apply([by('bob', 'edit.title', {id: 'board', name: 'Renamed'})]);
		expect(hasAuthoredEvents('bob')).toBe(true);
	});

	it('is false for everyone on a board nothing was written to', () => {
		unwrap(initWorkspaceState(nodes.workspace('root', 'Root', rank())));

		expect(hasAuthoredEvents('alice')).toBe(false);
	});
});
