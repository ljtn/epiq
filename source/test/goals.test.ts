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
} from '../mcp/epiq-api.js';
import {deriveGuiState} from '../mcp/api/state.js';
import {nodeRepo} from '../lib/repository/node-repo.js';
import {goalMark} from '../lib/utils/goal.utils.js';
import {Ticket} from '../lib/model/context.model.js';
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

	return {repoRoot, branchRoot, file, actor};
};

const issueOf = (id: string) => {
	const state = unwrap(deriveGuiState());

	return state.boards
		.flatMap(board => board.swimlanes.flatMap(lane => lane.issues))
		.find(candidate => candidate.id === id)!;
};

describe('a ticket in a goal', () => {
	it('carries the goal as it reads now, and leaves it again', async () => {
		const {repoRoot, file} = await seed();
		const epic = await file('Time travel');
		const part = await file('Needle in the URL');

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: epic}));

		const goal = issueOf(part).goal!;
		expect(goal.id).toBe(epic);
		expect(goal.title).toBe('Time travel');
		expect(goal.color).toMatch(/^#[0-9a-f]{6}$/i);
		expect(issueOf(epic).goal).toBeUndefined();

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: null}));
		expect(issueOf(part).goal).toBeUndefined();
		expect(Object.keys(issueOf(part))).not.toContain('goal');
	});

	it('takes the goal by ref, as an agent names it', async () => {
		const {repoRoot, file} = await seed();
		const epic = await file('Linked repos');
		const part = await file('Shallow clone');
		const ref = issueOf(epic).ref;

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: ref}));
		expect(issueOf(part).goal!.id).toBe(epic);
	});

	it('stays one level deep', async () => {
		const {repoRoot, file} = await seed();
		const epic = await file('Epic');
		const part = await file('Part');
		const other = await file('Other');

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: epic}));

		const self = await setIssueGoal({
			repoRoot,
			issueId: epic,
			goal: epic,
		});
		expect(isFail(self) && self.message).toMatch(/not its own goal/);

		const intoMember = await setIssueGoal({
			repoRoot,
			issueId: other,
			goal: part,
		});
		expect(isFail(intoMember) && intoMember.message).toMatch(
			/itself in a goal/,
		);

		const goalIntoOne = await setIssueGoal({
			repoRoot,
			issueId: epic,
			goal: other,
		});
		expect(isFail(goalIntoOne) && goalIntoOne.message).toMatch(/is a goal/);
	});

	it('draws no goal once the goal ticket is gone', async () => {
		const {repoRoot, branchRoot, file, actor} = await seed();
		const epic = await file('Short-lived');
		const part = await file('Survivor');

		unwrap(await setIssueGoal({repoRoot, issueId: part, goal: epic}));
		unwrap(
			materializeAndPersistAll(
				[
					{
						id: '01M5Z00000000000000000000C',
						...actor,
						action: 'delete.node',
						payload: {id: epic},
					},
				] as AppEvent[],
				branchRoot,
			),
		);

		expect(issueOf(part).goal).toBeUndefined();
		expect(goalMark(nodeRepo.getNode(part) as Ticket, 20)).toBeNull();
	});
});

describe('the terminal mark on a goal', () => {
	it('counts a member as soon as it joins', async () => {
		const {repoRoot, file} = await seed();
		const epic = await file('Epic');
		const one = await file('One');
		const two = await file('Two');
		const mark = () => goalMark(nodeRepo.getNode(epic) as Ticket, 30)?.text;

		expect(mark()).toBeUndefined();
		unwrap(await setIssueGoal({repoRoot, issueId: one, goal: epic}));
		expect(mark()).toBe('◆ goal (1)');
		unwrap(await setIssueGoal({repoRoot, issueId: two, goal: epic}));
		expect(mark()).toBe('◆ goal (2)');
		unwrap(await setIssueGoal({repoRoot, issueId: one, goal: null}));
		expect(mark()).toBe('◆ goal (1)');
	});
});

describe('a ticket whose goal is gone', () => {
	it('can become a goal itself', async () => {
		const {repoRoot, branchRoot, file, actor} = await seed();
		const gone = await file('Gone');
		const orphan = await file('Orphan');
		const joiner = await file('Joiner');

		unwrap(await setIssueGoal({repoRoot, issueId: orphan, goal: gone}));
		unwrap(
			materializeAndPersistAll(
				[
					{
						id: '01M5Z00000000000000000000D',
						...actor,
						action: 'delete.node',
						payload: {id: gone},
					},
				] as AppEvent[],
				branchRoot,
			),
		);

		unwrap(await setIssueGoal({repoRoot, issueId: joiner, goal: orphan}));
		expect(issueOf(joiner).goal!.id).toBe(orphan);
	});
});

describe('replaying goal events', () => {
	it('skips a ticket named as its own goal', async () => {
		const {file, actor} = await seed();
		const part = await file('Part');

		const [own] = materializeAll([
			{
				id: '01M5Z00000000000000000000A',
				...actor,
				action: 'set.issue.goal',
				payload: {id: part, goal: part},
			},
		] as AppEvent[]);

		expect(isFail(own as Result)).toBe(true);
		expect(issueOf(part).goal).toBeUndefined();
	});
});
