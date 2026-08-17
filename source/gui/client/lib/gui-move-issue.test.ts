import {describe, expect, it, vi} from 'vitest';
import {GuiState} from './gui-state.model';
import {moveIssue} from './gui-move-issue';

const issue = (id: string) =>
	({id, title: id} as GuiState['boards'][0]['swimlanes'][0]['issues'][0]);

const state = (): GuiState =>
	({
		boards: [
			{
				id: 'board',
				swimlanes: [
					{id: 'todo', title: 'Todo', issues: [issue('a')]},
					{id: 'doing', title: 'Doing', issues: [issue('x'), issue('y')]},
				],
			},
		],
	} as unknown as GuiState);

describe('moveIssue', () => {
	// React runs a state updater synchronously only as an eager optimisation and
	// skips it whenever an update is already queued. Deriving the payload inside
	// the updater therefore drops the move on a busy board.
	it('sends the move even when the updater is deferred', () => {
		const send = vi.fn();
		const deferred: React.Dispatch<React.SetStateAction<GuiState | null>> =
			vi.fn();

		moveIssue(state(), deferred, send)(['a'], 'doing', 1);

		expect(send).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith('issues:move', {
			issueId: 'a',
			parentId: 'doing',
			position: {at: 'before', sibling: 'y'},
		});
	});

	it('still applies the optimistic update', () => {
		let next: GuiState | null = null;
		const setState = (update: unknown) => {
			next =
				typeof update === 'function'
					? (update as (s: GuiState) => GuiState)(state())
					: (update as GuiState);
		};

		moveIssue(state(), setState as never, vi.fn())(['a'], 'doing', 'end');

		const lanes = next!.boards[0]!.swimlanes;
		expect(lanes[0]!.issues.map(i => i.id)).toEqual([]);
		expect(lanes[1]!.issues.map(i => i.id)).toEqual(['x', 'y', 'a']);
	});

	it('does nothing when the issue or lane is unknown', () => {
		const send = vi.fn();

		moveIssue(state(), vi.fn(), send)(['nope'], 'doing', 0);
		moveIssue(state(), vi.fn(), send)(['a'], 'nope', 0);
		moveIssue(null, vi.fn(), send)(['a'], 'doing', 0);

		expect(send).not.toHaveBeenCalled();
	});
});

describe('moveIssue with a selection', () => {
	it('sends one move per ticket, keeping their order', () => {
		const send = vi.fn();

		moveIssue(state(), vi.fn(), send)(['a', 'x'], 'doing', 0);

		expect(send).toHaveBeenCalledTimes(2);
		expect(send.mock.calls.map(call => call[1].issueId)).toEqual(['a', 'x']);
	});

	it('skips a ticket it cannot place without dropping the rest', () => {
		const send = vi.fn();

		moveIssue(state(), vi.fn(), send)(['nope', 'a'], 'doing', 'end');

		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]![1].issueId).toBe('a');
	});
});
