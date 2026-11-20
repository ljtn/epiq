import {describe, expect, it} from 'vitest';
import {ulid} from 'ulid';
import {createDefaultEvents} from '../lib/board/board-boot.js';
import {AppEvent} from '../lib/board/board-events.model.js';
import {materializeAndPersistAll} from '../lib/board/board-log.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {getRenderedChildren} from '../lib/state/state.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {assumeActor, listBoards, listSwimlanes} from '../mcp/epiq-api.js';
import {deriveGuiState} from '../mcp/api/state.js';
import {setupRepo, useTempHome} from './helpers/git-repo.js';

useTempHome();

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

// Concurrent inserts at one spot share a rank: every view orders them the same
// way, or a drop between them lands against a neighbour the GUI does not show.
describe('siblings of equal rank', () => {
	it('are in one order for the GUI and the TUI', async () => {
		const {repoRoot} = await setupRepo();
		const assumed = unwrap(await assumeActor({repoRoot, name: 'claude/peter'}));
		const root = unwrap(getStateBranchRoot({repoRoot}));
		unwrap(
			materializeAndPersistAll(
				[...unwrap(createDefaultEvents(assumed))] as AppEvent[],
				root,
			),
		);
		const board = unwrap(await listBoards({repoRoot})).find(b => !b.readonly)!;
		const lane = unwrap(await listSwimlanes({repoRoot, boardId: board.id}))[0]!;

		// Filed in the opposite order to their ids, at one rank.
		const later = ulid(Date.UTC(2030, 0, 1));
		const earlier = ulid(Date.UTC(2020, 0, 1));
		const file = (id: string) =>
			({
				id: ulid(),
				action: 'add.issue',
				payload: {id, name: id, parent: lane.id, rank: 'a8'},
				userId: assumed.userId,
			} as AppEvent);
		unwrap(materializeAndPersistAll([file(later), file(earlier)], root));

		const gui = unwrap(deriveGuiState())
			.boards.find(candidate => candidate.id === board.id)!
			.swimlanes.find(candidate => candidate.id === lane.id)!
			.issues.map(issue => issue.id);
		const tui = getRenderedChildren(lane.id).map(node => node.id);

		expect(gui).toEqual([earlier, later]);
		expect(gui).toEqual(tui);
	});
});
