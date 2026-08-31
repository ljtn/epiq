import {beforeEach, describe, expect, it} from 'vitest';
import {
	isConvergenceFail,
	materialize,
	materializeAll,
} from '../lib/event/event-materialize.js';
import {AppEvent} from '../lib/event/event.model.js';
import {CLOSED_SWIMLANE_ID} from '../lib/event/static-ids.js';
import {isTicketNode} from '../lib/model/context.model.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {nodes} from '../lib/state/node-builder.js';
import {initWorkspaceState} from '../lib/state/state.js';
import {bigIntToHex, midRank} from '../lib/utils/rank.js';

const IDS = {
	root: '01H00000000000000000000000',
	workspace: '01H00000000000000000000001',
	board: '01H00000000000000000000002',
	swimlaneTodo: '01H00000000000000000000003',
	swimlaneDoing: '01H00000000000000000000004',
	issue: '01H00000000000000000000005',
	missing: '01H00000000000000000000999',
} as const;

const rank = () => {
	const result = midRank();
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const actor = {
	userId: 'u1',
	userName: 'alice',
};

let eventSeq = 0;

const eventId = (): string =>
	`01H00000000000000000${String(++eventSeq).padStart(6, '0')}`;

const event = <A extends AppEvent['action']>(
	action: A,
	payload: Extract<AppEvent, {action: A}>['payload'],
): Extract<AppEvent, {action: A}> =>
	({
		id: eventId(),
		action,
		payload,
		...actor,
	} as Extract<AppEvent, {action: A}>);

const expectOk = (result: Result) => {
	expect(isFail(result)).toBe(false);
};

const setupWorkspace = () => {
	const results = materializeAll([
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
			id: IDS.swimlaneTodo,
			name: 'Todo',
			parent: IDS.board,
			rank: rank(),
		}),
		event('add.swimlane', {
			id: CLOSED_SWIMLANE_ID,
			name: 'Closed',
			parent: IDS.board,
			rank: 'z',
		}),
		event('add.issue', {
			id: IDS.issue,
			name: 'Issue',
			parent: IDS.swimlaneTodo,
			rank: rank(),
		}),
	] as const);

	for (const result of results) {
		expectOk(result);
	}
};

beforeEach(() => {
	eventSeq = 0;

	const rankResult = bigIntToHex(1n);
	if (isFail(rankResult)) throw new Error(rankResult.message);

	initWorkspaceState(nodes.workspace(IDS.root, 'Test Root', rankResult.value));
});

describe('event materialize', () => {
	it('materializes workspace, board, swimlane, and issue events', () => {
		setupWorkspace();

		expect(nodeRepo.getNode(IDS.workspace)).toBeDefined();
		expect(nodeRepo.getNode(IDS.board)?.parentNodeId).toBe(IDS.workspace);
		expect(nodeRepo.getNode(IDS.swimlaneTodo)?.parentNodeId).toBe(IDS.board);
		expect(nodeRepo.getNode(IDS.issue)?.parentNodeId).toBe(IDS.swimlaneTodo);
	});

	it('renames a node from edit.title without failing', () => {
		setupWorkspace();

		const result = materialize(
			event('edit.title', {
				id: IDS.issue,
				name: 'Renamed issue',
			}),
		);

		expectOk(result);
		expect(nodeRepo.getNode(IDS.issue)).toBeDefined();
	});

	it('fails edit.title when node does not exist', () => {
		const result = materialize(
			event('edit.title', {
				id: IDS.missing,
				name: 'Nope',
			}),
		);

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('edit title failed');
		}
	});

	it('moves an issue to another swimlane', () => {
		setupWorkspace();

		expectOk(
			materialize(
				event('add.swimlane', {
					id: IDS.swimlaneDoing,
					name: 'Doing',
					parent: IDS.board,
					rank: 't',
				}),
			),
		);

		const result = materialize(
			event('move.node', {
				id: IDS.issue,
				parent: IDS.swimlaneDoing,
				rank: rank(),
			}),
		);

		expectOk(result);
		expect(nodeRepo.getNode(IDS.issue)?.parentNodeId).toBe(IDS.swimlaneDoing);
	});

	it('closes an issue by moving it to the closed swimlane', () => {
		setupWorkspace();

		const result = materialize(
			event('close.issue', {
				id: IDS.issue,
				parent: CLOSED_SWIMLANE_ID,
				rank: rank(),
			}),
		);

		expectOk(result);
		expect(nodeRepo.getNode(IDS.issue)?.parentNodeId).toBe(CLOSED_SWIMLANE_ID);
	});

	it('closing an already closed issue is idempotent', () => {
		setupWorkspace();

		const closeEvent = event('close.issue', {
			id: IDS.issue,
			parent: CLOSED_SWIMLANE_ID,
			rank: rank(),
		});

		expectOk(materialize(closeEvent));
		expectOk(materialize(closeEvent));

		expect(nodeRepo.getNode(IDS.issue)?.parentNodeId).toBe(CLOSED_SWIMLANE_ID);
		expect(nodeRepo.getNode(IDS.issue)?.rank).toBe(closeEvent.payload.rank);
	});

	it('logs events on affected nodes by default', () => {
		setupWorkspace();

		const rename = event('edit.title', {
			id: IDS.issue,
			name: 'Logged rename',
		});

		const result = materialize(rename);

		expectOk(result);
		expect(
			nodeRepo.getNode(IDS.issue)?.log?.some(entry => entry.id === rename.id),
		).toBe(true);
	});

	it('does not log events when bypassLogging is true', () => {
		setupWorkspace();

		const rename = event('edit.title', {
			id: IDS.issue,
			name: 'Unlogged rename',
		});

		const result = materialize(rename, true);

		expectOk(result);
		expect(
			nodeRepo.getNode(IDS.issue)?.log?.some(entry => entry.id === rename.id),
		).toBe(false);
	});

	it('fails after successful handler when actor identity is invalid', () => {
		setupWorkspace();

		const result = materialize({
			...event('edit.title', {
				id: IDS.issue,
				name: 'Bad actor',
			}),
			userId: '',
		} satisfies AppEvent);

		expect(isFail(result)).toBe(true);
		if (isFail(result)) {
			expect(result.message).toContain('invalid user id format');
		}
	});

	it('materializeAll returns one result per event', () => {
		const events = [
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
		] as const;

		const results = materializeAll(events);

		expect(results).toHaveLength(2);
		expect(results.every(result => !isFail(result as Result))).toBe(true);
	});

	// A forged root carrying a lone `init.workspace` passes the root filter by
	// construction, and a high ULID anchors it after real history. Re-running
	// genesis resets state, wiping the board for every clone that pulls it.
	it('skips a second genesis rather than resetting the board', () => {
		const results = materializeAll([
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
			event('init.workspace', {
				id: IDS.missing,
				name: 'Forged',
				rank: rank(),
			}),
		] as const);

		expectOk(results[0]);
		expectOk(results[1]);
		// Skipped, not fatal: replay carries on past the forged root.
		expect(isConvergenceFail(results[2])).toBe(true);

		expect(nodeRepo.getNode(IDS.workspace)).toBeDefined();
		expect(nodeRepo.getNode(IDS.board)?.parentNodeId).toBe(IDS.workspace);
	});
});

describe('unknown event actions', () => {
	it('returns a failed result instead of crashing', () => {
		const foreign = {
			id: '01H00000000000000000009999',
			userId: 'u1',
			userName: 'alice',
			action: 'future.mystery.action',
			payload: {id: 'x', issue: 'y', hash: 'z'},
		} as unknown as AppEvent;

		const result = materialize(foreign);

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('Unknown event action');
	});
});

describe('issue attachments', () => {
	const attachmentId = '01H00000000000000000005001';
	const hash = 'a'.repeat(64);

	const addAttachment = () =>
		materialize(
			event('add.issue.attachment', {
				id: attachmentId,
				issue: IDS.issue,
				author: actor.userId,
				hash,
				ext: 'png',
				name: 'screenshot.png',
				bytes: 1234,
			}),
		);

	it('materializes add.issue.attachment onto the issue', () => {
		setupWorkspace();

		expectOk(addAttachment());

		const attachments = nodeRepo.getAttachmentsByIssue(IDS.issue);
		expect(attachments).toHaveLength(1);
		expect(attachments[0]).toMatchObject({
			id: attachmentId,
			issue: IDS.issue,
			hash,
			ext: 'png',
			name: 'screenshot.png',
			bytes: 1234,
		});
	});

	it('fails to attach to a missing issue', () => {
		setupWorkspace();

		const result = materialize(
			event('add.issue.attachment', {
				id: attachmentId,
				issue: IDS.missing,
				author: actor.userId,
				hash,
				ext: 'png',
				name: 'screenshot.png',
				bytes: 1234,
			}),
		);

		expect(isFail(result)).toBe(true);
	});

	it('delete.issue.attachment removes the reference', () => {
		setupWorkspace();
		expectOk(addAttachment());

		const result = materialize(
			event('delete.issue.attachment', {
				id: attachmentId,
				issue: IDS.issue,
			}),
		);

		expectOk(result);
		expect(nodeRepo.getAttachmentsByIssue(IDS.issue)).toHaveLength(0);
		// the record survives as deleted for replay purposes
		expect(nodeRepo.getAttachment(attachmentId)?.deleted).toBe(true);
	});

	it('fails to delete an attachment that does not exist', () => {
		setupWorkspace();

		const result = materialize(
			event('delete.issue.attachment', {
				id: attachmentId,
				issue: IDS.issue,
			}),
		);

		expect(isFail(result)).toBe(true);
	});
});

// Removal is a forward event, so what makes it trustworthy is that replay
// reproduces it identically everywhere.
describe('contributor tombstone round-trip', () => {
	const CONTRIBUTOR = '01H00000000000000000000100';

	it('clears the name on tombstone and puts it back on restore', () => {
		setupWorkspace();

		expectOk(
			materialize(
				event('create.contributor', {id: CONTRIBUTOR, name: 'Temp Tester'}),
			),
		);
		expect(nodeRepo.getContributor(CONTRIBUTOR)?.name).toBe('Temp Tester');

		expectOk(materialize(event('tombstone.contributor', {id: CONTRIBUTOR})));
		expect(nodeRepo.getContributor(CONTRIBUTOR)?.tombstoned).toBe(true);
		expect(nodeRepo.getContributor(CONTRIBUTOR)?.name).not.toBe('Temp Tester');

		expectOk(
			materialize(
				event('restore.contributor', {id: CONTRIBUTOR, name: 'Temp Tester'}),
			),
		);

		const restored = nodeRepo.getContributor(CONTRIBUTOR);
		expect(restored?.name).toBe('Temp Tester');
		// Cleared, not merely absent: read paths check the flag.
		expect(restored?.tombstoned).toBe(false);
	});

	// The id is why this is a tombstone and not a deletion.
	it('keeps the id stable across the whole sequence', () => {
		setupWorkspace();

		materializeAll([
			event('create.contributor', {id: CONTRIBUTOR, name: 'Temp Tester'}),
			event('add.issue.assignee', {id: IDS.issue, assignee: CONTRIBUTOR}),
			event('tombstone.contributor', {id: CONTRIBUTOR}),
		] as const);

		const issue = nodeRepo.getNode(IDS.issue);
		expect(isTicketNode(issue!) ? issue.props.assignees : undefined).toContain(
			CONTRIBUTOR,
		);
		expect(nodeRepo.getContributor(CONTRIBUTOR)).toBeDefined();
	});

	it('fails restore for a contributor that does not exist', () => {
		setupWorkspace();

		const result = materialize(
			event('restore.contributor', {id: IDS.missing, name: 'Nobody'}),
		);

		expect(isFail(result)).toBe(true);
	});
});

describe('tag tombstone round-trip', () => {
	const TAG = '01H00000000000000000000200';

	it('hides the tag on tombstone and shows it again on restore', () => {
		setupWorkspace();

		expectOk(materialize(event('create.tag', {id: TAG, name: 'bug'})));
		expectOk(materialize(event('add.issue.tag', {id: IDS.issue, tag: TAG})));
		expect(nodeRepo.getTag(TAG)?.name).toBe('bug');

		expectOk(materialize(event('tombstone.tag', {id: TAG})));
		// Absent to every reader, present as a record.
		expect(nodeRepo.getTag(TAG)).toBeUndefined();
		expect(nodeRepo.getTagRecord(TAG)?.tombstoned).toBe(true);
		expect(nodeRepo.findTagByName('bug')).toBeUndefined();
		expect(nodeRepo.getTags()).toEqual([]);

		expectOk(materialize(event('restore.tag', {id: TAG, name: 'bug'})));
		expect(nodeRepo.getTag(TAG)?.name).toBe('bug');
		expect(nodeRepo.getTagRecord(TAG)?.tombstoned).toBe(false);
	});

	// The id is why this is a tombstone and not a deletion.
	it('keeps the ticket reference across the whole sequence', () => {
		setupWorkspace();

		materializeAll([
			event('create.tag', {id: TAG, name: 'bug'}),
			event('add.issue.tag', {id: IDS.issue, tag: TAG}),
			event('tombstone.tag', {id: TAG}),
		] as const);

		const issue = nodeRepo.getNode(IDS.issue);
		expect(isTicketNode(issue!) ? issue.props.tags : undefined).toContain(TAG);
	});

	it('skips tagging with a deleted tag but still allows untagging', () => {
		setupWorkspace();

		materializeAll([
			event('create.tag', {id: TAG, name: 'bug'}),
			event('add.issue.tag', {id: IDS.issue, tag: TAG}),
			event('tombstone.tag', {id: TAG}),
		] as const);

		expect(
			isFail(materialize(event('add.issue.tag', {id: IDS.issue, tag: TAG}))),
		).toBe(true);
		expectOk(materialize(event('remove.issue.tag', {id: IDS.issue, tag: TAG})));
	});

	it('fails for a tag that does not exist', () => {
		setupWorkspace();

		expect(isFail(materialize(event('tombstone.tag', {id: IDS.missing})))).toBe(
			true,
		);
		expect(
			isFail(materialize(event('restore.tag', {id: IDS.missing, name: 'x'}))),
		).toBe(true);
	});
});
