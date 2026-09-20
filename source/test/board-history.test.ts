import {describe, expect, it} from 'vitest';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../lib/board/board-log.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {
	assumeActor,
	closeIssue,
	createBoard,
	createIssue,
	createSwimlane,
	listBoards,
	listSwimlanes,
	moveIssue,
	moveSwimlane,
} from '../mcp/epiq-api.js';
import {deriveGuiState} from '../mcp/api/state.js';
import {setupRepo, useTempHome} from './helpers/git-repo.js';

// KWYX3CX: an event belongs to the board the ticket was on when it happened,
// and the commits linked to it belong there too. So a ticket has to carry every
// board it has lived on, not the one it sits on now — otherwise the board a
// ticket was filed on loses the work done on it the moment somebody moves or
// closes it.

useTempHome();

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const boardsOf = (ref: string): string[] => {
	const state = unwrap(deriveGuiState());
	const issue = state.boards
		.flatMap(board => board.swimlanes.flatMap(lane => lane.issues))
		.find(candidate => candidate.ref === ref);

	expect(issue, `no ticket ${ref} in the payload`).toBeDefined();

	return issue!.boardIds;
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

	return {repoRoot, home, lane};
};

describe('the boards a ticket has lived on', () => {
	it('is the one it sits on, for a ticket that has not moved', async () => {
		const {repoRoot, home, lane} = await seed();
		const issue = unwrap(
			await createIssue({repoRoot, title: 'stays put', parentId: lane.id}),
		);

		expect(boardsOf(issue.ref)).toEqual([home.id]);
	});

	it('keeps the board it was closed from', async () => {
		const {repoRoot, home, lane} = await seed();
		const issue = unwrap(
			await createIssue({repoRoot, title: 'finished', parentId: lane.id}),
		);

		unwrap(await closeIssue({repoRoot, issueId: issue.id}));

		expect(boardsOf(issue.ref)).toContain(home.id);
	});

	it('keeps the board it was moved off', async () => {
		const {repoRoot, home, lane} = await seed();
		const issue = unwrap(
			await createIssue({repoRoot, title: 'relocated', parentId: lane.id}),
		);

		const other = unwrap(await createBoard({repoRoot, title: 'Elsewhere'}));
		const otherLane = unwrap(
			await createSwimlane({repoRoot, title: 'There', boardId: other.id}),
		);

		unwrap(
			await moveIssue({repoRoot, issueId: issue.id, parentId: otherLane.id}),
		);

		const boards = boardsOf(issue.ref);

		expect(boards).toContain(other.id);
		expect(boards).toContain(home.id);
	});
});

// The same question one level up: a lane can be moved between boards too, and
// a ticket's history must not follow it. Resolving a lane to its board as it
// stands today would hand board A's work to board B retroactively.
describe('a swimlane that changes board', () => {
	it('does not take the tickets that lived on it with it', async () => {
		const {repoRoot, home, lane} = await seed();
		const issue = unwrap(
			await createIssue({repoRoot, title: 'filed on home', parentId: lane.id}),
		);

		const other = unwrap(await createBoard({repoRoot, title: 'Elsewhere'}));
		unwrap(
			await moveSwimlane({repoRoot, swimlaneId: lane.id, boardId: other.id}),
		);

		expect(boardsOf(issue.ref)).toContain(home.id);
	});
});
