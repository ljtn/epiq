import {beforeEach, describe, expect, it, vi} from 'vitest';
import {succeeded} from '../lib/model/result-types.js';
import {MAX_SWIMLANE_DESCRIPTION_LENGTH} from '../lib/utils/text.limits.js';

const held = vi.hoisted(() => ({state: {} as Record<string, unknown>}));

vi.mock('../lib/editor/editor.js', () => ({openEditorOnText: vi.fn()}));
vi.mock('../lib/board/board-log.js', () => ({
	materializeAndPersistAll: vi.fn(() => [succeeded('persisted', null)]),
	resolveActorId: () => succeeded('actor', {userId: 'u1'}),
}));
vi.mock('../lib/storage/paths.js', () => ({
	getPersistRoot: async () => succeeded('root', '/state'),
}));
vi.mock('../lib/state/state.js', () => ({
	getState: () => held.state,
	getRenderedChildren: () => [],
}));

const {editCommand} = await import('../lib/command-line/commands/edit.cmd.js');
const {openEditorOnText} = await import('../lib/editor/editor.js');
const {materializeAndPersistAll} = await import('../lib/board/board-log.js');

const lane = {
	id: 'lane-1',
	title: 'Review',
	context: 'SWIMLANE',
	parentNodeId: 'b1',
	readonly: false,
	props: {description: 'Old'},
};
const board = {id: 'b1', title: 'Board', context: 'BOARD', parentNodeId: 'w1'};

const editDescription = () =>
	editCommand({modifier: 'description', inputString: ''} as never);

beforeEach(() => {
	vi.clearAllMocks();
	held.state = {
		contextNode: board,
		selectedIndex: 0,
		selectedNode: lane,
		breadCrumb: [board],
	};
});

describe('`edit description` on a lane in the TUI', () => {
	it("writes the lane's own description, opened on the current text", async () => {
		vi.mocked(openEditorOnText).mockReturnValue(succeeded('edited', 'New'));

		await editDescription();

		expect(openEditorOnText).toHaveBeenCalledWith('Old');
		expect(materializeAndPersistAll).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					action: 'edit.description',
					payload: {id: 'lane-1', md: 'New'},
				}),
			],
			'/state',
		);
	});

	it('refuses a locked lane, and one over its cap', async () => {
		held.state = {...held.state, selectedNode: {...lane, readonly: true}};
		const locked = await editDescription();

		held.state = {...held.state, selectedNode: lane};
		vi.mocked(openEditorOnText).mockReturnValue(
			succeeded('edited', 'x'.repeat(MAX_SWIMLANE_DESCRIPTION_LENGTH + 1)),
		);
		const long = await editDescription();

		expect(locked.message).toBe('Cannot edit readonly node');
		expect(long.message).toContain('cannot exceed');
		expect(materializeAndPersistAll).not.toHaveBeenCalled();
	});
});
