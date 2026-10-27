import {repoIdOf} from '../lib/board/board-repos.js';
import {describe, expect, it} from 'vitest';
import {ulid} from 'ulid';
import {bootStateFromEventLog} from '../lib/board/board-boot.js';
import {materializeAll} from '../lib/board/board-log.js';
import {partitionMaterializeResults} from '../lib/event/event-materialize.js';
import {AppEvent, EVENT_ACTIONS} from '../lib/board/board-events.model.js';
import {projectLogNames} from '../lib/board/log-names.js';
import {CLOSED_BOARD_ID, CLOSED_SWIMLANE_ID} from '../lib/board/static-ids.js';
import {isFail} from '../lib/model/result-types.js';
import {getState} from '../lib/state/state.js';

// `projectLogNames` must agree with the board's registries without booting one.
// The fixture covers every action, so a new naming action can't slip past both.

const WORKSPACE = '01J000000000000000000WSPC';
const WORKSPACE2 = '01J00000000000000000WSPC2';
const BOARD = '01J0000000000000000000BRD';
const LANE = '01J000000000000000000LANE';
// Renamed and then deleted, because `buildLaneNames` exists to keep naming a
// lane the board no longer has.
const GONE_LANE = '01J00000000000000000GONEL';
const ISSUE = '01J0000000000000000ISSUE0';
const FIELD = '01J0000000000000000FIELD0';
const COMMENT = '01J000000000000000COMMENT';
const ATTACHMENT = '01J0000000000000000ATTACH';
const ALICE = '01J00000000000000000ALICE';
const BOB = '01J0000000000000000000BOB';
const CAROL = '01J00000000000000000CAROL';
const TAG = '01J0000000000000000000TAG';
const GOAL = '01J000000000000000000GOAL';
const NAMELESS = '01J00000000000000NAMELESS';
// Named by an event that creates nothing, which both sides have to refuse — or
// the projection knows somebody the board does not.
const STRANGER = '01J00000000000000STRANGER';
const STRANGER_TAG = '01J000000000000STRANGERTG';

let seq = 0;
const at = <A extends AppEvent['action']>(
	action: A,
	payload: Extract<AppEvent, {action: A}>['payload'],
): AppEvent =>
	({
		id: ulid(1_700_000_000_000 + seq++),
		action,
		payload,
		userId: ALICE,
	} as AppEvent);

// A board that boots, and every action there is applied to it — in an order
// where each one lands, so that covering an action means exercising it.
const log = (): AppEvent[] => [
	at('init.workspace', {id: WORKSPACE, name: 'Workspace', rank: 'a0'}),
	at('add.workspace', {id: WORKSPACE2, name: 'Second', rank: 'a1'}),

	at('add.board', {id: BOARD, name: 'Board', parent: WORKSPACE, rank: 'a0'}),
	at('add.swimlane', {id: LANE, name: 'Backlog', parent: BOARD, rank: 'a0'}),
	at('add.swimlane', {id: GONE_LANE, name: 'Spike', parent: BOARD, rank: 'a1'}),

	// `close.issue` refuses any target but this one, so the closed board and its
	// lane have to exist before an issue can be closed.
	at('add.board', {
		id: CLOSED_BOARD_ID,
		name: 'Closed',
		parent: WORKSPACE,
		rank: 'a2',
	}),
	at('add.swimlane', {
		id: CLOSED_SWIMLANE_ID,
		name: 'Closed',
		parent: CLOSED_BOARD_ID,
		rank: 'a0',
	}),

	at('add.issue', {id: ISSUE, name: 'Issue', parent: LANE, rank: 'a0'}),
	at('add.field', {id: FIELD, name: 'Notes', parent: ISSUE, rank: 'a0'}),
	at('edit.description', {id: ISSUE, md: 'A description'}),
	at('add.swimlane.rule', {id: LANE, rule: 'done'}),
	at('remove.swimlane.rule', {id: LANE, rule: 'done'}),

	at('create.contributor', {id: ALICE, name: 'alice'}),
	at('rename.contributor', {id: ALICE, name: 'Alice Cooper'}),
	at('link.contributor.user', {contributor: ALICE}),
	// Neither names anybody; the unlink retracts the link above it.
	at('link.contributor.email', {
		contributor: ALICE,
		email: 'alice@example.com',
	}),
	at('unlink.contributor.email', {
		contributor: ALICE,
		email: 'alice@example.com',
	}),

	// Repo events name no contributor: the projection must pass them by.
	at('connect.repo', {url: 'https://example.com/team/a.git'}),
	at('edit.repo', {
		repo: repoIdOf('https://example.com/team/a.git'),
		since: 'all',
	}),
	at('disconnect.repo', {repo: repoIdOf('https://example.com/team/a.git')}),

	at('create.contributor', {id: BOB, name: 'bob'}),
	at('tombstone.contributor', {id: BOB}),
	// Refused on a tombstoned record on both sides, or a rename would quietly
	// undo a removal.
	at('rename.contributor', {id: BOB, name: 'bob again'}),

	at('create.contributor', {id: CAROL, name: 'carol'}),
	at('tombstone.contributor', {id: CAROL}),
	at('restore.contributor', {id: CAROL, name: 'Carol Restored'}),

	// An empty `name` is still a real record the registry will rename.
	at('create.contributor', {id: NAMELESS, name: ''}),
	at('rename.contributor', {id: NAMELESS, name: 'Found A Name'}),

	at('create.tag', {id: TAG, name: 'bug'}),
	at('tombstone.tag', {id: TAG}),
	at('restore.tag', {id: TAG, name: 'defect'}),

	// `node-repo` refuses renaming or restoring what was never created; so must
	// the projection.
	at('rename.contributor', {id: STRANGER, name: 'Nobody'}),
	at('restore.tag', {id: STRANGER_TAG, name: 'Nothing'}),

	at('add.issue.assignee', {id: ISSUE, assignee: ALICE}),
	at('remove.issue.assignee', {id: ISSUE, assignee: ALICE}),
	at('add.issue.tag', {id: ISSUE, tag: TAG}),
	at('remove.issue.tag', {id: ISSUE, tag: TAG}),
	// A goal names nobody: a record in the project, and a field on a ticket.
	at('create.goal', {id: GOAL, name: 'Ship it'}),
	at('rename.goal', {id: GOAL, name: 'Ship it soon'}),
	at('edit.goal.description', {id: GOAL, md: 'Why it matters'}),
	at('add.issue.goal', {id: ISSUE, goal: GOAL}),
	at('remove.issue.goal', {id: ISSUE, goal: GOAL}),
	at('tombstone.goal', {id: GOAL}),

	at('add.issue.comment', {
		id: COMMENT,
		issue: ISSUE,
		author: ALICE,
		md: 'A comment',
	}),
	at('edit.issue.comment', {id: COMMENT, issue: ISSUE, md: 'Edited'}),
	at('delete.issue.comment', {id: COMMENT, issue: ISSUE}),

	at('add.issue.attachment', {
		id: ATTACHMENT,
		issue: ISSUE,
		author: ALICE,
		hash: 'abc123',
		ext: 'png',
		name: 'shot.png',
		bytes: 12,
	}),
	at('delete.issue.attachment', {id: ATTACHMENT, issue: ISSUE}),

	at('move.node', {id: ISSUE, parent: GONE_LANE, rank: 'a0'}),
	at('close.issue', {id: ISSUE, parent: CLOSED_SWIMLANE_ID, rank: 'a0'}),
	at('reopen.issue', {id: ISSUE, parent: LANE, rank: 'a1'}),
	at('rebalance.children', {parent: LANE, ranks: {[ISSUE]: 'a0'}}),
	at('lock.node', {id: CLOSED_BOARD_ID}),

	// An issue's title moves through the same action as a lane's, so a title
	// edit only counts as a rename for an id one of the node cases created.
	at('edit.title', {id: ISSUE, name: 'Issue Renamed'}),
	at('edit.title', {id: LANE, name: 'Icebox'}),
	at('edit.title', {id: GONE_LANE, name: 'Spike Renamed'}),
	at('delete.node', {id: GONE_LANE}),
];

const booted = () => {
	const result = bootStateFromEventLog(log());
	if (isFail(result)) throw new Error(result.message);

	return getState();
};

describe('the fixture log', () => {
	// Every covered action must apply at least once; some are meant to be
	// refused, and that refusal is what they pin.
	it('applies every action it covers at least once', () => {
		const events = log();
		const results = materializeAll(events);

		const applied = new Set(
			events.filter((_, index) => !isFail(results[index]!)).map(e => e.action),
		);

		expect(events.map(e => e.action).filter(a => !applied.has(a))).toEqual([]);
		expect(partitionMaterializeResults(results).fatal).toEqual([]);
	});

	// A new action in `EVENT_ACTIONS` fails here until the fixture exercises it.
	it('exercises every action the build understands', () => {
		const covered = new Set(log().map(event => event.action));

		expect(EVENT_ACTIONS.filter(action => !covered.has(action))).toEqual([]);
	});
});

describe('names projected from the log', () => {
	it('agrees with the contributor registry a boot builds', () => {
		const projected = projectLogNames(log()).byId;
		const registry = new Map(
			Object.values(booted().contributors).map(({id, name}) => [id, name]),
		);

		for (const [id, name] of registry) {
			expect(projected.get(id), `contributor ${id}`).toBe(name);
		}

		expect(registry.size).toBeGreaterThan(0);
	});

	// The other direction: a name the projection knows and the registry doesn't.
	it('names nobody the registry has never heard of', () => {
		const {byId} = projectLogNames(log());
		const {contributors, tags} = booted();

		for (const id of [ALICE, BOB, CAROL, NAMELESS, STRANGER]) {
			expect(byId.has(id), `contributor ${id}`).toBe(id in contributors);
		}

		for (const id of [TAG, STRANGER_TAG]) {
			expect(byId.has(id), `tag ${id}`).toBe(id in tags);
		}
	});

	it('agrees with the tag registry a boot builds', () => {
		const projected = projectLogNames(log()).byId;

		for (const tag of Object.values(booted().tags)) {
			expect(projected.get(tag.id), `tag ${tag.id}`).toBe(tag.name);
		}
	});

	// The two key cases, spelled out rather than left to the sweep above.
	it('carries a rename', () => {
		expect(projectLogNames(log()).byId.get(ALICE)).toBe('Alice Cooper');
	});

	it('clears a tombstoned name, and keeps it cleared through a rename', () => {
		expect(projectLogNames(log()).byId.get(BOB)).toBe('removed');
	});

	it('carries a name a restore brought back', () => {
		expect(projectLogNames(log()).byId.get(CAROL)).toBe('Carol Restored');
	});

	it('renames a contributor created without a name', () => {
		expect(projectLogNames(log()).byId.get(NAMELESS)).toBe('Found A Name');
	});

	it('carries a tag restored under a new name', () => {
		expect(projectLogNames(log()).byId.get(TAG)).toBe('defect');
	});

	it('renames a lane, and names it in the lane index alone', () => {
		const {byId, lanes} = projectLogNames(log());

		expect(lanes[LANE]).toBe('Icebox');
		expect(byId.get(BOARD)).toBe('Board');
		expect(lanes[BOARD]).toBeUndefined();
	});

	// What the lane index is for: a chart drawn from history still has to name
	// the lane its dots sat in.
	it('keeps naming a lane the board has since deleted', () => {
		expect(projectLogNames(log()).lanes[GONE_LANE]).toBe('Spike Renamed');
	});

	// `edit.title` is every node's rename, so it must only count for the kinds
	// this projection tracks.
	it('ignores a title edit on a node it never named', () => {
		expect(projectLogNames(log()).byId.has(ISSUE)).toBe(false);
	});

	it('names nothing an empty log never mentioned', () => {
		expect(projectLogNames([]).byId.size).toBe(0);
	});
});

// The projection carries state between events, so each naming sequence is
// compared, in several orders, against a board booted from the same log.
describe('a naming sequence, in any order', () => {
	const SUBJECT = '01J000000000000000SUBJECT';

	const orderings: [string, AppEvent[]][] = [
		[
			'tombstone, re-create, rename',
			[
				at('create.contributor', {id: SUBJECT, name: 'first'}),
				at('tombstone.contributor', {id: SUBJECT}),
				at('create.contributor', {id: SUBJECT, name: 'second'}),
				at('rename.contributor', {id: SUBJECT, name: 'third'}),
			],
		],
		[
			'tombstone, re-create',
			[
				at('create.contributor', {id: SUBJECT, name: 'first'}),
				at('tombstone.contributor', {id: SUBJECT}),
				at('create.contributor', {id: SUBJECT, name: 'second'}),
			],
		],
		[
			'tombstone twice, then rename',
			[
				at('create.contributor', {id: SUBJECT, name: 'first'}),
				at('tombstone.contributor', {id: SUBJECT}),
				at('tombstone.contributor', {id: SUBJECT}),
				at('rename.contributor', {id: SUBJECT, name: 'second'}),
			],
		],
		[
			'restore, tombstone, restore',
			[
				at('create.contributor', {id: SUBJECT, name: 'first'}),
				at('tombstone.contributor', {id: SUBJECT}),
				at('restore.contributor', {id: SUBJECT, name: 'second'}),
				at('tombstone.contributor', {id: SUBJECT}),
				at('restore.contributor', {id: SUBJECT, name: 'third'}),
			],
		],
		[
			'tombstone before any create, then create and rename',
			[
				at('tombstone.contributor', {id: SUBJECT}),
				at('create.contributor', {id: SUBJECT, name: 'first'}),
				at('rename.contributor', {id: SUBJECT, name: 'second'}),
			],
		],
		[
			'tag tombstoned, re-created, restored',
			[
				at('create.tag', {id: SUBJECT, name: 'first'}),
				at('tombstone.tag', {id: SUBJECT}),
				at('create.tag', {id: SUBJECT, name: 'second'}),
				at('restore.tag', {id: SUBJECT, name: 'third'}),
			],
		],
	];

	for (const [order, tail] of orderings) {
		it(`agrees with the board: ${order}`, () => {
			const events = [...log(), ...tail];

			const result = bootStateFromEventLog(events);
			if (isFail(result)) throw new Error(result.message);

			const state = getState();
			const onBoard = state.contributors[SUBJECT] ?? state.tags[SUBJECT];

			expect(projectLogNames(events).byId.get(SUBJECT)).toBe(onBoard?.name);
		});
	}
});
