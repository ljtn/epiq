import {describe, expect, it} from 'vitest';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {
	materializeAll,
	materializeAndPersistAll,
} from '../lib/board/board-log.js';
import {CLOSED_SWIMLANE_ID} from '../lib/board/static-ids.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {laneRules} from '../lib/utils/lane-rules.js';
import {Swimlane} from '../lib/model/context.model.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {
	assumeActor,
	closeIssue,
	createGoal,
	createIssue,
	editSwimlaneTitle,
	listBoards,
	listSwimlanes,
	moveIssue,
	setIssueGoal,
	setSwimlaneRule,
} from '../mcp/epiq-api.js';
import {deriveGuiState} from '../mcp/api/state.js';
import {setupRepo, useTempHome} from './helpers/git-repo.js';

useTempHome();

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

// A board with a goal of four tickets, one standing in each lane given.
const seed = async () => {
	const {repoRoot} = await setupRepo();
	const assumed = unwrap(await assumeActor({repoRoot, name: 'claude/peter'}));
	unwrap(
		materializeAndPersistAll(
			[...unwrap(createDefaultEvents(assumed))] as AppEvent[],
			unwrap(getStateBranchRoot({repoRoot})),
		),
	);

	const board = unwrap(await listBoards({repoRoot})).find(b => !b.readonly)!;
	const lanes = unwrap(await listSwimlanes({repoRoot, boardId: board.id}));
	const lane = (title: string) =>
		lanes.find(candidate => candidate.title.toLowerCase() === title)!;

	const first = lanes[0]!;
	const goal = unwrap(await createGoal({repoRoot, name: 'Ship'}));
	const file = async (title: string, parentId: string) => {
		const {id} = unwrap(
			await createIssue({repoRoot, title, parentId: first.id}),
		);
		unwrap(await setIssueGoal({repoRoot, issueId: id, goal: goal.id}));
		if (parentId !== first.id) {
			unwrap(await moveIssue({repoRoot, issueId: id, parentId}));
		}
		return id;
	};

	const progress = () =>
		unwrap(deriveGuiState())
			.boards.find(candidate => candidate.id === board.id)!
			.goals.find(candidate => candidate.id === goal.id)!;

	return {repoRoot, assumed, board, lanes, lane, first, file, progress};
};

describe('a lane rule', () => {
	it('counts a lane called Done while no lane on the board has the done rule', async () => {
		const {lane, first, file, progress} = await seed();
		await file('Waiting', first.id);
		await file('Finished', lane('done').id);

		expect(progress()).toMatchObject({done: 1, total: 2});
	});

	it('counts only lanes with the done rule once one has it, however named', async () => {
		const {repoRoot, lane, first, file, progress} = await seed();
		await file('Waiting', first.id);
		await file('In Done', lane('done').id);
		await file('Released', first.id);

		unwrap(
			await setSwimlaneRule({
				repoRoot,
				swimlaneId: first.id,
				rule: 'done',
				on: true,
			}),
		);
		// Every ticket in the first lane now counts; Done's no longer does.
		expect(progress()).toMatchObject({done: 2, total: 3});

		unwrap(
			await setSwimlaneRule({
				repoRoot,
				swimlaneId: lane('done').id,
				rule: 'done',
				on: true,
			}),
		);
		expect(progress()).toMatchObject({done: 3, total: 3});

		unwrap(
			await setSwimlaneRule({
				repoRoot,
				swimlaneId: first.id,
				rule: 'done',
				on: false,
			}),
		);
		expect(progress()).toMatchObject({done: 1, total: 3});
	});

	it('counts a closed ticket done whatever the lanes say', async () => {
		const {repoRoot, lane, first, file, progress} = await seed();
		const closed = await file('Closed', first.id);
		unwrap(await closeIssue({repoRoot, issueId: closed}));
		unwrap(
			await setSwimlaneRule({
				repoRoot,
				swimlaneId: lane('done').id,
				rule: 'done',
				on: true,
			}),
		);

		expect(progress()).toMatchObject({done: 1, total: 1});
	});

	it('stays with its lane through a rename', async () => {
		const {repoRoot, first, file, progress} = await seed();
		await file('Shipped', first.id);
		unwrap(
			await setSwimlaneRule({
				repoRoot,
				swimlaneId: first.id,
				rule: 'done',
				on: true,
			}),
		);
		unwrap(
			await editSwimlaneTitle({repoRoot, swimlaneId: first.id, title: 'Klart'}),
		);

		expect(progress()).toMatchObject({done: 1, total: 1});
		const listed = unwrap(await listSwimlanes({repoRoot})).find(
			l => l.id === first.id,
		);
		expect(listed).toMatchObject({title: 'Klart', rules: ['done']});
	});

	it('refuses a rule it does not know, and the Closed lane', async () => {
		const {repoRoot, first} = await seed();

		const unknown = await setSwimlaneRule({
			repoRoot,
			swimlaneId: first.id,
			rule: 'lock',
			on: true,
		});
		expect(isFail(unknown) && unknown.message).toMatch(/No lane rule/);

		const closed = await setSwimlaneRule({
			repoRoot,
			swimlaneId: CLOSED_SWIMLANE_ID,
			rule: 'done',
			on: true,
		});
		expect(isFail(closed)).toBe(true);
	});

	it('writes nothing when the lane already is as asked', async () => {
		const {repoRoot, first} = await seed();
		const off = unwrap(
			await setSwimlaneRule({
				repoRoot,
				swimlaneId: first.id,
				rule: 'done',
				on: false,
			}),
		);
		expect(off).toMatchObject({rule: 'done'});
		expect((nodeRepo.getNode(first.id) as Swimlane).props).not.toHaveProperty(
			'rules',
		);
	});

	it('keeps a rule a newer build wrote, and reads nothing into it', async () => {
		const {assumed, first, file, progress} = await seed();
		await file('Waiting', first.id);

		materializeAll([
			{
				id: '01M5Z00000000000000000000A',
				userId: assumed.userId,
				action: 'add.swimlane.rule',
				payload: {id: first.id, rule: 'alert'},
			} as unknown as AppEvent,
		]);

		const lane = nodeRepo.getNode(first.id) as Swimlane;
		expect(lane.props.rules).toEqual(['alert']);
		expect(laneRules(lane)).toEqual([]);
		expect(progress()).toMatchObject({done: 0, total: 1});
	});
});
