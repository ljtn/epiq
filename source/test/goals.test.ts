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
	createSwimlane,
	moveIssue,
	deleteSwimlane,
	listGoals,
	editGoalDescription,
	editSwimlaneDescription,
	getIssue,
} from '../mcp/epiq-api.js';
import {deriveGuiState} from '../mcp/api/state.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {goalMark} from '../lib/utils/goal.utils.js';
import {Ticket} from '../lib/model/context.model.js';
import {getState} from '../lib/state/state.js';
import {CLOSED_BOARD_ID} from '../lib/board/static-ids.js';
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
	it('is made in the project, and named, coloured and counted', async () => {
		const {repoRoot} = await seed();

		const {id} = unwrap(await createGoal({repoRoot, name: 'Time travel'}));

		expect(unwrap(await listGoals({repoRoot}))).toEqual([
			{
				id,
				name: 'Time travel',
				color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
				done: 0,
				total: 0,
				boards: [],
			},
		]);
	});

	it('is listed with its progress and the boards its tickets are on', async () => {
		const {repoRoot, boardId, file} = await seed();
		const part = await file('Part');
		const {id} = unwrap(
			await createGoal({repoRoot, name: 'Listed', issueId: part}),
		);
		const empty = unwrap(await createGoal({repoRoot, name: 'Empty'}));

		const listed = unwrap(await listGoals({repoRoot})).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
		expect(listed).toMatchObject([
			{id: empty.id, name: 'Empty', total: 0, boards: []},
			{id, name: 'Listed', done: 0, total: 1, boards: [{id: boardId}]},
		]);
	});

	it('keeps its colour through a rename', async () => {
		const {repoRoot} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, name: 'Before'}));
		const [before] = unwrap(await listGoals({repoRoot}));

		unwrap(await renameGoal({repoRoot, goalId: id, name: 'After'}));

		expect(unwrap(await listGoals({repoRoot}))[0]).toMatchObject({
			name: 'After',
			color: before!.color,
		});
	});

	it('refuses a second goal of the same name', async () => {
		const {repoRoot} = await seed();
		unwrap(await createGoal({repoRoot, name: 'Linked repos'}));

		const again = await createGoal({repoRoot, name: 'linked REPOS'});
		expect(isFail(again) && again.message).toMatch(/already a goal/);
	});

	it('counts its tickets done when closed or in a lane called Done', async () => {
		const {repoRoot, boardId, file} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, name: 'Goal'}));
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
		const {id} = unwrap(await createGoal({repoRoot, name: 'Passing'}));
		const part = await file('Part');
		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: id}));

		unwrap(await removeGoal({repoRoot, goalId: id}));

		expect(goalsOf(boardId)).toEqual([]);
		expect(issueOf(part).goal).toBeUndefined();
		expect(issueOf(part).title).toBe('Part');
		expect(goalMark(nodeRepo.getNode(part) as Ticket, 20)).toBeNull();
	});
});

describe("a goal's description", () => {
	it('is set by name and listed with the goal, not repeated on its tickets', async () => {
		const {repoRoot, file} = await seed();
		const part = await file('Part');
		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: 'Launch'}));

		unwrap(
			await editGoalDescription({
				repoRoot,
				goal: 'launch',
				description: 'Ship **mobile** by spring',
			}),
		);

		expect(unwrap(await listGoals({repoRoot}))[0]).toMatchObject({
			name: 'Launch',
			description: 'Ship **mobile** by spring',
		});
		expect(
			unwrap(await getIssue({repoRoot, idOrRef: part})),
		).not.toHaveProperty('goalDescription');
	});

	it('clears when emptied', async () => {
		const {repoRoot, file} = await seed();
		const part = await file('Part');
		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: 'Quiet'}));
		unwrap(
			await editGoalDescription({repoRoot, goal: 'Quiet', description: 'x'}),
		);

		unwrap(
			await editGoalDescription({repoRoot, goal: 'Quiet', description: '  '}),
		);

		expect(unwrap(await listGoals({repoRoot}))[0]).not.toHaveProperty(
			'description',
		);
	});

	it('refuses a goal that is gone or never was, and over the cap', async () => {
		const {repoRoot} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, name: 'Gone'}));
		unwrap(await removeGoal({repoRoot, goalId: id}));

		expect(
			isFail(await editGoalDescription({repoRoot, goal: id, description: 'x'})),
		).toBe(true);
		expect(
			isFail(
				await editGoalDescription({repoRoot, goal: 'Never', description: 'x'}),
			),
		).toBe(true);

		unwrap(await createGoal({repoRoot, name: 'Capped'}));
		const long = await editGoalDescription({
			repoRoot,
			goal: 'Capped',
			description: 'x'.repeat(4001),
		});
		expect(isFail(long)).toBe(true);
	});

	it("keeps a goal's description and a lane's apart", async () => {
		const {repoRoot, boardId} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, name: 'Apart'}));
		const lane = unwrap(await listSwimlanes({repoRoot, boardId}))[0]!;

		unwrap(
			await editGoalDescription({repoRoot, goal: id, description: 'Goal text'}),
		);
		unwrap(
			await editSwimlaneDescription({
				repoRoot,
				swimlaneId: lane.id,
				description: 'Lane text',
			}),
		);

		expect(getState().goals[id]?.description).toBe('Goal text');
		expect(unwrap(await listSwimlanes({repoRoot, boardId}))[0]).toMatchObject({
			description: 'Lane text',
		});
	});
});

describe('replaying a goal description', () => {
	const describe_ = (actor: {userId: string}, id: string, at: string) =>
		({
			id: at,
			...actor,
			action: 'edit.goal.description',
			payload: {id, md: 'Late'},
		} as unknown as AppEvent);

	it('skips one for a goal it never made, or one removed before it', async () => {
		const {repoRoot, actor} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, name: 'Gone'}));
		unwrap(await removeGoal({repoRoot, goalId: id}));

		const [missing, removed] = materializeAll([
			describe_(
				actor,
				'01M5Z0000000000000000000ZZ',
				'01M5Z00000000000000000000A',
			),
			describe_(actor, id, '01M5Z00000000000000000000B'),
		]);

		expect(isFail(missing as Result)).toBe(true);
		expect(isFail(removed as Result)).toBe(true);
		expect(getState().goals[id]).not.toHaveProperty('description');
	});
});

describe('a ticket in a goal', () => {
	it('carries the goal as it reads now, and leaves it again', async () => {
		const {repoRoot, file} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, name: 'Time travel'}));
		const part = await file('Needle in the URL');

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: id}));
		expect(issueOf(part).goal).toMatchObject({id, name: 'Time travel'});
		expect(goalMark(nodeRepo.getNode(part) as Ticket, 30)?.text).toBe(
			'◆ Time travel',
		);

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: null}));
		expect(Object.keys(issueOf(part))).not.toContain('goal');
	});

	it('joins a goal by name, making it when there is none of that name', async () => {
		const {repoRoot, boardId, file} = await seed();
		const one = await file('One');
		const two = await file('Two');

		unwrap(await setIssueGoal({repoRoot, issueId: one, goal: 'Dense cards'}));
		unwrap(await setIssueGoal({repoRoot, issueId: two, goal: 'dense cards'}));

		expect(goalsOf(boardId)).toHaveLength(1);
		expect(issueOf(two).goal!.id).toBe(issueOf(one).goal!.id);
	});

	it('joins a new goal in the same write that makes it', async () => {
		const {repoRoot, file} = await seed();
		const part = await file('Part');
		const before = getState().eventLog.length;

		unwrap(await createGoal({repoRoot, name: 'Bigger', issueId: part}));

		expect(issueOf(part).goal!.name).toBe('Bigger');
		expect(getState().eventLog.length - before).toBe(2);
	});

	it("joins a goal another board's tickets are in", async () => {
		const {repoRoot, boardId, file} = await seed();
		const other = unwrap(await createBoard({repoRoot, title: 'Other'}));
		const otherLane = unwrap(
			await createSwimlane({repoRoot, boardId: other.id, title: 'Lane'}),
		);
		const there = unwrap(
			await createIssue({repoRoot, title: 'There', parentId: otherLane.id}),
		).id;
		const {id} = unwrap(
			await createGoal({repoRoot, name: 'Shared', issueId: there}),
		);
		const here = await file('Here');

		unwrap(await setIssueGoal({repoRoot, issueId: here, goal: 'shared'}));

		expect(issueOf(here).goal!.id).toBe(id);
		expect(goalsOf(boardId)).toMatchObject([
			{id, total: 2, members: [{id: here, done: false}]},
		]);
		expect(goalsOf(other.id)).toMatchObject([
			{id, total: 2, members: [{id: there, done: false}]},
		]);
	});
});

describe('a goal across boards', () => {
	it('goes with its ticket to another board, and shows there', async () => {
		const {repoRoot, boardId, file} = await seed();
		const part = await file('Traveller');
		const {id} = unwrap(
			await createGoal({repoRoot, name: 'Home', issueId: part}),
		);
		const away = unwrap(await createBoard({repoRoot, title: 'Away'}));
		const awayLane = unwrap(
			await createSwimlane({repoRoot, boardId: away.id, title: 'Lane'}),
		);

		unwrap(await moveIssue({repoRoot, issueId: part, parentId: awayLane.id}));

		expect(issueOf(part).goal!.id).toBe(id);
		expect(goalsOf(away.id)).toMatchObject([
			{id, total: 1, members: [{id: part}]},
		]);
		expect(goalsOf(boardId)).toEqual([]);
	});

	it('shows one with no tickets yet on no board', async () => {
		const {repoRoot, boardId} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, name: 'Fresh'}));

		expect(goalsOf(boardId)).toEqual([]);
		expect(goalsOf(CLOSED_BOARD_ID)).toEqual([]);
		expect(unwrap(await listGoals({repoRoot}))).toMatchObject([
			{id, boards: []},
		]);
	});

	it('keeps a closed ticket in its goal, on the board it was worked on', async () => {
		const {repoRoot, boardId, file} = await seed();
		const part = await file('Finished');
		unwrap(await createGoal({repoRoot, name: 'Kept', issueId: part}));
		unwrap(await closeIssue({repoRoot, issueId: part}));

		expect(issueOf(part).goal!.name).toBe('Kept');
		expect(goalsOf(boardId)).toMatchObject([
			{name: 'Kept', done: 1, total: 1, members: [{id: part, done: true}]},
		]);

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: 'Other'}));
		expect(issueOf(part).goal!.name).toBe('Other');

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: null}));
		expect(issueOf(part).goal).toBeUndefined();
	});

	it('drops the tickets of a deleted lane from its count', async () => {
		const {repoRoot, boardId, file} = await seed();
		const lane = unwrap(
			await createSwimlane({repoRoot, boardId, title: 'Doomed'}),
		);
		const gone = unwrap(
			await createIssue({repoRoot, title: 'Gone', parentId: lane.id}),
		).id;
		const kept = await file('Kept');
		unwrap(await createGoal({repoRoot, name: 'Survivor', issueId: gone}));
		unwrap(await setIssueGoal({repoRoot, issueId: kept, goal: 'Survivor'}));

		unwrap(await deleteSwimlane({repoRoot, swimlaneId: lane.id}));

		expect(goalsOf(boardId)).toMatchObject([{total: 1, members: [{id: kept}]}]);
	});

	it('takes an id that names no goal as a mistake, not a new name', async () => {
		const {repoRoot, file} = await seed();
		const part = await file('Part');

		const result = await setIssueGoal({
			repoRoot,
			issueId: part,
			goal: '01M5Z0000000000000000000QQ',
		});

		expect(isFail(result) && result.message).toMatch(/No goal has the id/);
		expect(unwrap(deriveGuiState()).goals).toEqual([]);
	});

	it('finds a goal whatever spacing its name was typed with', async () => {
		const {repoRoot, boardId, file} = await seed();
		const part = await file('Part');
		unwrap(await createGoal({repoRoot, name: 'Dense cards'}));

		const result = unwrap(
			await setIssueGoal({repoRoot, issueId: part, goal: '  Dense\tcards '}),
		);

		expect(result).toBeDefined();
		expect(goalsOf(boardId)).toHaveLength(1);
		expect(issueOf(part).goal!.name).toBe('Dense cards');
	});
});

describe('replaying goal events', () => {
	const setGoal = (
		actor: {userId: string},
		id: string,
		goal: unknown,
		at: string,
		action = 'add.issue.goal',
	) =>
		({
			id: at,
			...actor,
			action,
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
		const {repoRoot, file, actor} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, name: 'Gone'}));
		const part = await file('Part');
		unwrap(await removeGoal({repoRoot, goalId: id}));

		const [result] = materializeAll([
			setGoal(actor, part, id, '01M5Z00000000000000000000B'),
		]);

		expect(isFail(result as Result)).toBe(true);
		expect(nodeRepo.getNode(part)?.props).not.toHaveProperty('goals');
	});

	it('leaves the goal as it is for one it cannot read', async () => {
		const {repoRoot, file, actor} = await seed();
		const part = await file('Part');
		const {id} = unwrap(
			await createGoal({repoRoot, name: 'Kept', issueId: part}),
		);

		const [result] = materializeAll([
			setGoal(actor, part, {ref: 'later'}, '01M5Z00000000000000000000C'),
		]);

		expect(isFail(result as Result)).toBe(true);
		expect(issueOf(part).goal!.id).toBe(id);
	});

	it('reads one goal of two machines put a ticket in, the first, until one is set', async () => {
		const {repoRoot, boardId, file, actor} = await seed();
		const part = await file('Part');
		const first = unwrap(await createGoal({repoRoot, name: 'First'})).id;
		const second = unwrap(await createGoal({repoRoot, name: 'Second'})).id;

		// Each machine added its own goal, not having seen the other's.
		materializeAll([
			setGoal(actor, part, first, '01M5Z00000000000000000000G'),
			setGoal(actor, part, second, '01M5Z00000000000000000000H'),
		]);

		expect((nodeRepo.getNode(part) as Ticket).props.goals).toEqual([
			first,
			second,
		]);
		expect(issueOf(part).goal!.id).toBe(first);
		expect(goalsOf(boardId).map(goal => goal.name)).toEqual(['First']);

		// Setting one goal takes the ticket out of the other.
		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: second}));
		expect((nodeRepo.getNode(part) as Ticket).props.goals).toEqual([second]);
		expect(goalsOf(boardId).map(goal => goal.name)).toEqual(['Second']);
	});

	it('takes a ticket out of a goal removed since', async () => {
		const {repoRoot, file} = await seed();
		const part = await file('Part');
		const {id} = unwrap(
			await createGoal({repoRoot, name: 'Gone', issueId: part}),
		);
		unwrap(await removeGoal({repoRoot, goalId: id}));
		const kept = unwrap(await createGoal({repoRoot, name: 'Kept'})).id;

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: kept}));
		expect((nodeRepo.getNode(part) as Ticket).props.goals).toEqual([kept]);
	});

	it('keeps both goals two machines named alike, and finds the older', async () => {
		const {repoRoot, file, actor} = await seed();
		const make = (id: string) => ({
			id,
			...actor,
			action: 'create.goal',
			payload: {id, name: 'Launch'},
		});
		materializeAll([
			make('01M5Z00000000000000000000E'),
			make('01M5Z00000000000000000000F'),
		] as AppEvent[]);
		const part = await file('Part');

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: 'Launch'}));

		expect(unwrap(await listGoals({repoRoot})).map(goal => goal.name)).toEqual([
			'Launch',
			'Launch',
		]);
		expect(issueOf(part).goal!.id).toBe('01M5Z00000000000000000000E');
	});

	it('makes a goal once per id', async () => {
		const {repoRoot, boardId, actor} = await seed();
		const {id} = unwrap(await createGoal({repoRoot, name: 'First'}));
		unwrap(await removeGoal({repoRoot, goalId: id}));

		const [again] = materializeAll([
			{
				id: '01M5Z00000000000000000000G',
				...actor,
				action: 'create.goal',
				payload: {id, name: 'Revived'},
			},
		] as AppEvent[]);

		expect(isFail(again as Result)).toBe(true);
		expect(goalsOf(boardId)).toEqual([]);
	});
});
