import {describe, expect, it, vi} from 'vitest';
import {isFail} from '../lib/model/result-types.js';

// Reads materialized state and never boots, which is the point of it — so it
// never reaches the log file names either. `loadActorNames` records that split
// and who else follows it.
vi.mock('../lib/event/event-load.js', async importOriginal => ({
	...(await importOriginal<typeof import('../lib/event/event-load.js')>()),
	loadActorNames: vi.fn(() => {
		throw new Error('getIssueHistory must not read the log');
	}),
}));

const state = {
	nodes: {} as Record<string, unknown>,
	contributors: {} as Record<string, {id: string; name: string}>,
};

vi.mock('../mcp/api/boot.js', () => ({
	getStateResult: () => ({
		status: 'success',
		message: 'state',
		value: state,
	}),
}));

const {getIssueHistory} = await import('../mcp/api/issues.js');

const ISSUE = '01J000000000000000000ISSU';
const ALICE = '01J00000000000000000ALICE';
const STRANGER = '01J000000000000000STRANGE';

const withLog = (authorIds: string[]) => {
	state.nodes[ISSUE] = {
		id: ISSUE,
		log: authorIds.map((userId, index) => ({
			id: `01J0000000000000000000000${index}`,
			action: 'edit.title',
			payload: {id: ISSUE, name: 'x'},
			userId,
		})),
	};
};

// The actor on a ticket's history used to be built from the event's own
// `userName`, which came off the log's file name — so a renamed contributor
// kept their old name through a ticket's whole history, and since ZFZFW9D an
// event carries no name at all.
describe('the actor on a ticket history entry', () => {
	it('is the registry name for the id, whatever the event was written under', () => {
		state.contributors[ALICE] = {id: ALICE, name: 'Alice Cooper'};
		withLog([ALICE]);

		const result = getIssueHistory(ISSUE);

		if (isFail(result)) throw new Error(result.message);
		expect(result.value[0]!.actor).toMatchObject({
			id: ALICE,
			name: 'Alice Cooper',
		});
	});

	it('is the id where the registry has never heard of them', () => {
		withLog([STRANGER]);

		const result = getIssueHistory(ISSUE);

		if (isFail(result)) throw new Error(result.message);
		expect(result.value[0]!.actor?.name).toBe(STRANGER);
	});
});
