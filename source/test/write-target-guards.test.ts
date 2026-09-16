import {describe, expect, it} from 'vitest';
import {getStateBranchRoot} from '../git/git-storage.js';
import {createDefaultEvents} from '../lib/event/event-boot.js';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {AppEvent} from '../lib/event/event.model.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {
	addIssueAssignee,
	addIssueComment,
	addIssueTag,
	assumeActor,
	closeIssue,
	createIssue,
	createSwimlane,
	deleteSwimlane,
	listBoards,
	listSwimlanes,
	moveIssue,
	moveSwimlane,
	reopenIssue,
} from '../mcp/epiq-api.js';
import {setupRepo, useTempHome} from './helpers/git-repo.js';

// Every write names its target or its parent by id. The door checks the id is
// a live node of the kind the write expects and refuses otherwise: a ticket
// filed under a board, or a comment on a swimlane, would enter the log and
// never show anywhere.

useTempHome();

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const failure = (result: Result<unknown>): string =>
	isFail(result) ? result.message : 'succeeded';

const seedBoard = async () => {
	const {repoRoot} = await setupRepo();

	const assumed = unwrap(await assumeActor({repoRoot, name: 'claude/peter'}));
	const branchRoot = unwrap(getStateBranchRoot({repoRoot}));
	const defaults = unwrap(createDefaultEvents(assumed));
	unwrap(materializeAndPersistAll([...defaults] as AppEvent[], branchRoot));

	const boards = unwrap(await listBoards({repoRoot}));
	const board = boards.find(b => !b.readonly)!;
	const swimlanes = unwrap(await listSwimlanes({repoRoot, boardId: board.id}));

	const issue = unwrap(
		await createIssue({repoRoot, title: 'seed', parentId: swimlanes[0]!.id}),
	);

	return {repoRoot, board, swimlanes, issue};
};

describe('an issue parent must be a swimlane', () => {
	it('createIssue refuses a board', async () => {
		const {repoRoot, board} = await seedBoard();

		const result = await createIssue({
			repoRoot,
			title: 'filed under a board',
			parentId: board.id,
		});

		expect(failure(result)).toBe('Target must be a swimlane');
	});

	it('createIssue refuses an unknown id', async () => {
		const {repoRoot} = await seedBoard();

		const result = await createIssue({
			repoRoot,
			title: 'filed under nothing',
			parentId: 'no-such-node',
		});

		expect(failure(result)).toBe('Swimlane not found');
	});

	it('moveIssue refuses a board', async () => {
		const {repoRoot, board, issue} = await seedBoard();

		const moved = await moveIssue({
			repoRoot,
			issueId: issue.id,
			parentId: board.id,
		});

		expect(failure(moved)).toBe('Target must be a swimlane');
	});

	it('moveIssue refuses another issue', async () => {
		const {repoRoot, swimlanes, issue} = await seedBoard();

		const other = unwrap(
			await createIssue({repoRoot, title: 'other', parentId: swimlanes[0]!.id}),
		);

		const moved = await moveIssue({
			repoRoot,
			issueId: other.id,
			parentId: issue.id,
		});

		expect(failure(moved)).toBe('Target must be a swimlane');
	});

	it('reopenIssue refuses when the old lane is gone', async () => {
		const {repoRoot, board, issue} = await seedBoard();

		const lane = unwrap(
			await createSwimlane({repoRoot, boardId: board.id, title: 'Short lived'}),
		);
		unwrap(await moveIssue({repoRoot, issueId: issue.id, parentId: lane.id}));
		unwrap(await closeIssue({repoRoot, issueId: issue.id}));
		unwrap(await deleteSwimlane({repoRoot, swimlaneId: lane.id}));

		const reopened = await reopenIssue({repoRoot, issueId: issue.id});

		expect(failure(reopened)).toBe('Swimlane not found');
	});

	it('a swimlane works for create and move', async () => {
		const {repoRoot, swimlanes, issue} = await seedBoard();

		const moved = await moveIssue({
			repoRoot,
			issueId: issue.id,
			parentId: swimlanes[1]!.id,
		});

		expect(failure(moved)).toBe('succeeded');
		expect(!isFail(moved) && moved.value.parentId).toBe(swimlanes[1]!.id);
	});
});

describe('a swimlane parent must be a board', () => {
	it('createSwimlane refuses a swimlane', async () => {
		const {repoRoot, swimlanes} = await seedBoard();

		const result = await createSwimlane({
			repoRoot,
			boardId: swimlanes[0]!.id,
			title: 'nested lane',
		});

		expect(failure(result)).toBe('Target must be a board');
	});

	it('moveSwimlane refuses a swimlane as destination', async () => {
		const {repoRoot, swimlanes} = await seedBoard();

		const result = await moveSwimlane({
			repoRoot,
			swimlaneId: swimlanes[0]!.id,
			boardId: swimlanes[1]!.id,
		});

		expect(failure(result)).toBe('Target must be a board');
	});

	it('moveSwimlane refuses an issue as the lane', async () => {
		const {repoRoot, board, issue} = await seedBoard();

		const result = await moveSwimlane({
			repoRoot,
			swimlaneId: issue.id,
			boardId: board.id,
		});

		expect(failure(result)).toBe('Target must be a swimlane');
	});
});

describe('an issue write must name an issue', () => {
	it('addIssueComment refuses a board', async () => {
		const {repoRoot, board} = await seedBoard();

		const result = await addIssueComment({
			repoRoot,
			issueId: board.id,
			body: 'on a board',
		});

		expect(failure(result)).toBe('Target must be an issue');
	});

	it('addIssueTag refuses a swimlane', async () => {
		const {repoRoot, swimlanes} = await seedBoard();

		const result = await addIssueTag({
			repoRoot,
			issueId: swimlanes[0]!.id,
			tagName: 'on-a-lane',
		});

		expect(failure(result)).toContain('Target must be an issue');
	});

	it('addIssueAssignee refuses a board', async () => {
		const {repoRoot, board} = await seedBoard();

		const result = await addIssueAssignee({
			repoRoot,
			issueId: board.id,
			self: true,
		});

		expect(failure(result)).toBe('Target must be an issue');
	});
});
