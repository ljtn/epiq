import {describe, expect, it} from 'vitest';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {
	materializeAll,
	materializeAndPersistAll,
} from '../lib/board/board-log.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {
	assumeActor,
	createIssue,
	listBoards,
	listSwimlanes,
	setIssueGoal,
	createGoal,
	renameGoal,
	removeGoal,
	closeIssue,
	createBoard,
	moveIssue,
} from '../mcp/epiq-api.js';
import {deriveGuiState} from '../mcp/api/state.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {goalMark} from '../lib/utils/goal.utils.js';
import {Ticket} from '../lib/model/context.model.js';
import {getState} from '../lib/state/state.js';
import {setupRepo, useTempHome} from './helpers/git-repo.js';

useTempHome();

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const seed = async () => {
	const {repoRoot} = await setupRepo();
	const assumed = unwrap(await assumeActor({repoRoot, name: 'claude/peter'}));
	const branchRoot = unwrap(getStateBranchRoot({repoRoot}));
	unwrap(
		materializeAndPersistAll(
			[...unwrap(createDefaultEvents(assumed))] as AppEvent[],
			branchRoot,
		),
	);

	const home = unwrap(await listBoards({repoRoot})).find(b => !b.readonly)!;
	const lane = unwrap(await listSwimlanes({repoRoot, boardId: home.id}))[0]!;
	const file = async (title: string) =>
		unwrap(await createIssue({repoRoot, title, parentId: lane.id})).id;

	const actor = {userId: assumed.userId};

	return {repoRoot, branchRoot, file, actor, boardId: home.id};
};

const issueOf = (id: string) => {
	const state = unwrap(deriveGuiState());

	return state.boards
		.flatMap(board => board.swimlanes.flatMap(lane => lane.issues))
		.find(candidate => candidate.id === id)!;
};

const goalsOf = (boardId: string) =>
	unwrap(deriveGuiState()).boards.find(board => board.id === boardId)!.goals;

describe('a goal', () => {
	it('is made on a board, and named, coloured and counted there', async () => {
		const {repoRoot, boardId} = await seed();

		const {id} = unwrap(
			await createGoal({repoRoot, boardId, name: 'Time travel'}),
		);

		expect(goalsOf(boardId)).toEqual([
			{
				id,
				name: 'Time travel',
				color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
				done: 0,
				total: 0,
			},
		]);
	});

	it('keeps its colour through a rename', async () => {
		const {repoRoot, boardId} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, boardId, name: 'Before'}));
		const color = goalsOf(boardId)[0]!.color;

		unwrap(await renameGoal({repoRoot, goalId: id, name: 'After'}));

		expect(goalsOf(boardId)[0]).toMatchObject({name: 'After', color});
	});

	it('refuses a second goal of the same name on a board', async () => {
		const {repoRoot, boardId} = await seed();
		unwrap(await createGoal({repoRoot, boardId, name: 'Linked repos'}));

		const again = await createGoal({repoRoot, boardId, name: 'linked REPOS'});
		expect(isFail(again) && again.message).toMatch(/already has a goal/);
	});

	it('counts its tickets done when closed or in a lane called Done', async () => {
		const {repoRoot, boardId, file} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, boardId, name: 'Goal'}));
		const one = await file('One');
		const two = await file('Two');
		const three = await file('Three');
		for (const issueId of [one, two, three]) {
			unwrap(await setIssueGoal({repoRoot, issueId, goal: id}));
		}

		unwrap(await closeIssue({repoRoot, issueId: one}));
		const done = unwrap(await listSwimlanes({repoRoot, boardId})).find(
			lane => lane.title.toLowerCase() === 'done',
		)!;
		unwrap(await moveIssue({repoRoot, issueId: two, parentId: done.id}));

		expect(goalsOf(boardId)[0]).toMatchObject({done: 2, total: 3});
	});

	it('leaves its tickets where they are, in no goal, once removed', async () => {
		const {repoRoot, boardId, file} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, boardId, name: 'Passing'}));
		const part = await file('Part');
		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: id}));

		unwrap(await removeGoal({repoRoot, goalId: id}));

		expect(goalsOf(boardId)).toEqual([]);
		expect(issueOf(part).goal).toBeUndefined();
		expect(issueOf(part).title).toBe('Part');
		expect(goalMark(nodeRepo.getNode(part) as Ticket, 20)).toBeNull();
	});
});

describe('a ticket in a goal', () => {
	it('carries the goal as it reads now, and leaves it again', async () => {
		const {repoRoot, boardId, file} = await seed();
		const {id} = unwrap(
			await createGoal({repoRoot, boardId, name: 'Time travel'}),
		);
		const part = await file('Needle in the URL');

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: id}));
		expect(issueOf(part).goal).toMatchObject({id, name: 'Time travel'});
		expect(goalMark(nodeRepo.getNode(part) as Ticket, 30)?.text).toBe(
			'◆ Time travel',
		);

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: null}));
		expect(Object.keys(issueOf(part))).not.toContain('goal');
	});

	it('joins a goal by name, making it when the board has none of that name', async () => {
		const {repoRoot, boardId, file} = await seed();
		const one = await file('One');
		const two = await file('Two');

		unwrap(await setIssueGoal({repoRoot, issueId: one, goal: 'Dense cards'}));
		unwrap(await setIssueGoal({repoRoot, issueId: two, goal: 'dense cards'}));

		expect(goalsOf(boardId)).toHaveLength(1);
		expect(issueOf(two).goal!.id).toBe(issueOf(one).goal!.id);
	});

	it('joins a new goal in the same write that makes it', async () => {
		const {repoRoot, boardId, file} = await seed();
		const part = await file('Part');
		const before = getState().eventLog.length;

		unwrap(
			await createGoal({repoRoot, boardId, name: 'Bigger', issueId: part}),
		);

		expect(issueOf(part).goal!.name).toBe('Bigger');
		expect(getState().eventLog.length - before).toBe(2);
	});

	it("refuses another board's goal", async () => {
		const {repoRoot, file} = await seed();
		const other = unwrap(await createBoard({repoRoot, title: 'Other'}));
		const {id} = unwrap(
			await createGoal({repoRoot, boardId: other.id, name: 'Elsewhere'}),
		);
		const part = await file('Part');

		const result = await setIssueGoal({repoRoot, issueId: part, goal: id});
		expect(isFail(result) && result.message).toMatch(/another board/);
	});
});

describe('replaying goal events', () => {
	const setGoal = (
		actor: {userId: string},
		id: string,
		goal: unknown,
		at: string,
	) =>
		({
			id: at,
			...actor,
			action: 'set.issue.goal',
			payload: {id, goal},
		} as unknown as AppEvent);

	it('skips a link to a goal it never made', async () => {
		const {file, actor} = await seed();
		const part = await file('Part');

		const [result] = materializeAll([
			setGoal(
				actor,
				part,
				'01M5Z0000000000000000000ZZ',
				'01M5Z00000000000000000000A',
			),
		]);

		expect(isFail(result as Result)).toBe(true);
		expect(issueOf(part).goal).toBeUndefined();
	});

	it('skips a link to a goal removed before it', async () => {
		const {repoRoot, boardId, file, actor} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, boardId, name: 'Gone'}));
		const part = await file('Part');
		unwrap(await removeGoal({repoRoot, goalId: id}));

		const [result] = materializeAll([
			setGoal(actor, part, id, '01M5Z00000000000000000000B'),
		]);

		expect(isFail(result as Result)).toBe(true);
		expect(nodeRepo.getNode(part)?.props).not.toHaveProperty('goal');
	});

	it('leaves the goal as it is for one it cannot read', async () => {
		const {repoRoot, boardId, file, actor} = await seed();
		const part = await file('Part');
		const {id} = unwrap(
			await createGoal({repoRoot, boardId, name: 'Kept', issueId: part}),
		);

		const [result] = materializeAll([
			setGoal(actor, part, {ref: 'later'}, '01M5Z00000000000000000000C'),
		]);

		expect(isFail(result as Result)).toBe(true);
		expect(issueOf(part).goal!.id).toBe(id);
	});

	it('skips a goal made on a board it never saw', async () => {
		const {boardId, actor} = await seed();

		const [result] = materializeAll([
			{
				id: '01M5Z00000000000000000000D',
				...actor,
				action: 'create.goal',
				payload: {
					id: '01M5Z00000000000000000000D',
					name: 'Nowhere',
					board: '01M5Z0000000000000000000YY',
				},
			},
		] as AppEvent[]);

		expect(isFail(result as Result)).toBe(true);
		expect(goalsOf(boardId)).toEqual([]);
	});
});
