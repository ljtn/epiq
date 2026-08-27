import {beforeEach, describe, expect, it} from 'vitest';
import {materialize, materializeAll} from '../lib/event/event-materialize.js';
import {AppEvent} from '../lib/event/event.model.js';
import {CLOSED_SWIMLANE_ID} from '../lib/event/static-ids.js';
import {isFail} from '../lib/model/result-types.js';
import {nodes} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex, midRank} from '../lib/utils/rank.js';

// materializeAll batches derivation to one pass instead of one per event, which
// is what took a 1429-event replay from 905ms to 278ms. The whole safety
// argument rests on derive() being a pure function of the base state, so
// running it once at the end must land on exactly the state that running it
// after every event would have. That is what this asserts — directly, rather
// than hoping a rendered TUI screen happens to disagree.
//
// It now covers the same argument for the event logs and the ticket virtual
// fields, which are collected during a replay and applied once at the end.

const IDS = {
	root: '01H00000000000000000000000',
	workspace: '01H00000000000000000000001',
	board: '01H00000000000000000000002',
	todo: '01H00000000000000000000003',
	doing: '01H00000000000000000000004',
	tag: '01H00000000000000000000006',
	contributor: '01H00000000000000000000007',
} as const;

const rank = () => {
	const result = midRank();
	if (isFail(result)) throw new Error(result.message);

	return result.value;
};

let eventSeq = 0;

const event = <A extends AppEvent['action']>(
	action: A,
	payload: Extract<AppEvent, {action: A}>['payload'],
): Extract<AppEvent, {action: A}> =>
	({
		id: `01H00000000000000000${String(++eventSeq).padStart(6, '0')}`,
		action,
		payload,
		userId: 'u1',
		userName: 'alice',
	} as Extract<AppEvent, {action: A}>);

const issueId = (n: number) =>
	`01H0000000000000000010${String(n).padStart(4, '0')}`;

// Deliberately varied: node creation, renames, the tag and assignee paths, a
// comment, a move between swimlanes and a close. A derived index that went
// stale would show up as a different child ordering or a different selection.
const buildEvents = (issueCount: number): AppEvent[] => {
	eventSeq = 0;

	const log: AppEvent[] = [
		event('init.workspace', {
			id: IDS.workspace,
			name: 'Workspace',
			rank: rank(),
		}),
		event('add.board', {
			id: IDS.board,
			name: 'Board',
			parent: IDS.workspace,
			rank: rank(),
		}),
		event('add.swimlane', {
			id: IDS.todo,
			name: 'Todo',
			parent: IDS.board,
			rank: rank(),
		}),
		event('add.swimlane', {
			id: IDS.doing,
			name: 'Doing',
			parent: IDS.board,
			rank: rank(),
		}),
		event('add.swimlane', {
			id: CLOSED_SWIMLANE_ID,
			name: 'Closed',
			parent: IDS.board,
			rank: 'z',
		}),
		event('create.tag', {id: IDS.tag, name: 'bug'}),
		event('create.contributor', {id: IDS.contributor, name: 'alice'}),
	];

	for (let i = 0; i < issueCount; i++) {
		const id = issueId(i);

		log.push(
			event('add.issue', {
				id,
				name: `Issue ${i}`,
				parent: i % 2 === 0 ? IDS.todo : IDS.doing,
				rank: rank(),
			}),
			event('edit.title', {id, name: `Issue ${i} renamed`}),
			event('edit.description', {id, md: `Body of issue ${i}`}),
		);

		if (i % 3 === 0) log.push(event('add.issue.tag', {id, tag: IDS.tag}));
		if (i % 4 === 0)
			log.push(event('add.issue.assignee', {id, assignee: IDS.contributor}));
		if (i % 5 === 0)
			log.push(
				event('add.issue.comment', {
					id: `01H000000000000000002${String(i).padStart(5, '0')}`,
					issue: id,
					author: 'u1',
					md: `Comment on ${i}`,
				}),
			);
		if (i % 6 === 0)
			log.push(event('move.node', {id, parent: IDS.doing, rank: rank()}));
		// Closing relocates the node, so it carries a position like a move does.
		if (i % 7 === 0)
			log.push(
				event('close.issue', {
					id,
					parent: CLOSED_SWIMLANE_ID,
					rank: rank(),
				}),
			);
	}

	return log;
};

const freshState = () => {
	const rankResult = bigIntToHex(1n);
	if (isFail(rankResult)) throw new Error(rankResult.message);

	initWorkspaceState(nodes.workspace(IDS.root, 'Test Root', rankResult.value));
};

// Derived per event, the way every write did before batching.
const replayOneByOne = (log: AppEvent[]) => {
	freshState();
	for (const entry of log) materialize(entry);

	return getState();
};

const replayBatched = (log: AppEvent[]) => {
	freshState();
	materializeAll(log);

	return getState();
};

beforeEach(() => {
	eventSeq = 0;
});

describe('batched replay equals per-event replay', () => {
	it('lands on the same derived state for a small log', () => {
		const log = buildEvents(3);

		expect(replayBatched(log)).toEqual(replayOneByOne(log));
	});

	it('lands on the same derived state for a log of a few hundred events', () => {
		// Large enough that a stale index or a missed rebuild would diverge.
		const log = buildEvents(80);
		expect(log.length).toBeGreaterThan(300);

		expect(replayBatched(log)).toEqual(replayOneByOne(log));
	});

	it('agrees on the fields derive() owns, not just the base state', () => {
		const log = buildEvents(40);
		const batched = replayBatched(log);
		const oneByOne = replayOneByOne(log);

		// Spelled out so a regression names the field that drifted.
		expect(batched.renderedChildrenIndex).toEqual(
			oneByOne.renderedChildrenIndex,
		);
		expect(batched.contextNode).toEqual(oneByOne.contextNode);
		expect(batched.selectedNode).toEqual(oneByOne.selectedNode);
		expect(batched.breadCrumb).toEqual(oneByOne.breadCrumb);
	});

	it('agrees on the node set itself', () => {
		const log = buildEvents(40);

		expect(Object.keys(replayBatched(log).nodes).sort()).toEqual(
			Object.keys(replayOneByOne(log).nodes).sort(),
		);
	});
});
