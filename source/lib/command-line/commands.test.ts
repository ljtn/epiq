import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('ulid', () => ({
	monotonicFactory: () => () => 'generated-id',
	ulid: vi.fn(),
}));

vi.mock('../../event/event-materialize-and-persist.js', () => ({
	materializeAndPersist: vi.fn(),
	materializeAndPersistAll: vi.fn(),
}));

vi.mock('../../repository/node-repo.js', () => ({
	findAncestor: vi.fn(),
	nodeRepo: {},
}));

vi.mock('../../repository/rank.js', () => ({
	getOrderedChildren: vi.fn(),
}));

vi.mock('../state/cmd.state.js', () => ({
	getCmdArg: vi.fn(),
	getCmdState: vi.fn(),
}));

vi.mock('../state/state.js', () => ({
	getState: vi.fn(),
	patchState: vi.fn(),
	updateState: vi.fn(),
}));

import {ulid} from 'ulid';
import {materializeAndPersist} from '../../event/event-materialize-and-persist.js';
import {findAncestor} from '../../repository/node-repo.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {getCmdState} from '../state/cmd.state.js';
import {getState} from '../state/state.js';
import {commands} from './commands.js';
import {CmdIntent} from './command-meta.js';
import {failed, succeeded} from './command-types.js';

const mockedUlid = vi.mocked(ulid);
const mockedMaterializeAndPersist = vi.mocked(materializeAndPersist);
const mockedFindAncestor = vi.mocked(findAncestor);
const mockedGetOrderedChildren = vi.mocked(getOrderedChildren);
const mockedGetCmdState = vi.mocked(getCmdState);
const mockedGetState = vi.mocked(getState);

const tagCommand = commands.find(x => x.intent === CmdIntent.TagTicket)!;
const assignCommand = commands.find(
	x => x.intent === CmdIntent.AssignUserToTicket,
)!;

describe('TagTicket command', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		mockedGetCmdState.mockReturnValue({
			commandMeta: {
				modifier: 'bug',
				inputString: '',
			},
		} as any);

		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {},
			contributors: {},
		} as any);

		mockedGetOrderedChildren.mockReturnValue([{id: 'selected-node'}] as any);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {id: 'ticket-1'}) as any,
		);
	});

	it('reuses an existing tag id instead of generating a new one', () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'},
			},
			contributors: {},
		} as any);

		mockedMaterializeAndPersist.mockReturnValue(
			succeeded('Tagged issue', {
				targetId: 'ticket-1',
				tagId: 'tag-123',
			}) as any,
		);

		tagCommand.action({} as any, {} as any);

		expect(mockedUlid).not.toHaveBeenCalled();

		expect(mockedMaterializeAndPersist).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersist).toHaveBeenCalledWith({
			action: 'tag.issue',
			payload: {
				targetId: 'ticket-1',
				tagId: 'tag-123',
			},
		});
	});

	it('creates a new tag when none exists, then tags the ticket', () => {
		mockedUlid.mockReturnValue('new-tag-id');

		mockedMaterializeAndPersist
			.mockReturnValueOnce(succeeded('Created tag', 'new-tag-id') as any)
			.mockReturnValueOnce(
				succeeded('Tagged issue', {
					targetId: 'ticket-1',
					tagId: 'new-tag-id',
				}) as any,
			);

		tagCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersist).toHaveBeenNthCalledWith(1, {
			action: 'create.tag',
			payload: {
				id: 'new-tag-id',
				name: 'bug',
			},
		});
		expect(mockedMaterializeAndPersist).toHaveBeenNthCalledWith(2, {
			action: 'tag.issue',
			payload: {
				targetId: 'ticket-1',
				tagId: 'new-tag-id',
			},
		});
	});

	it('tags the ticket id, not the selected child id', () => {
		mockedGetOrderedChildren.mockReturnValue([
			{id: 'description-field-id'},
		] as any);

		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'},
			},
			contributors: {},
		} as any);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {id: 'ticket-99'}) as any,
		);

		mockedMaterializeAndPersist.mockReturnValue(
			succeeded('Tagged issue', {
				targetId: 'ticket-99',
				tagId: 'tag-123',
			}) as any,
		);

		tagCommand.action({} as any, {} as any);

		expect(mockedMaterializeAndPersist).toHaveBeenCalledWith({
			action: 'tag.issue',
			payload: {
				targetId: 'ticket-99',
				tagId: 'tag-123',
			},
		});
	});

	it('fails when no selected node exists', () => {
		mockedGetOrderedChildren.mockReturnValue([]);

		const result = tagCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Selection node not found'));
		expect(mockedMaterializeAndPersist).not.toHaveBeenCalled();
	});
});

describe('AssignUserToTicket command', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		mockedGetCmdState.mockReturnValue({
			commandMeta: {
				modifier: 'alice',
				inputString: '',
			},
		} as any);

		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {},
			contributors: {},
		} as any);

		mockedGetOrderedChildren.mockReturnValue([{id: 'selected-node'}] as any);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {id: 'ticket-1'}) as any,
		);
	});

	it('reuses an existing contributor id instead of generating a new one', () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {},
			contributors: {
				'user-123': {id: 'user-123', name: 'alice'},
			},
		} as any);

		mockedMaterializeAndPersist.mockReturnValue(
			succeeded('Assigned issue', {
				targetId: 'ticket-1',
				contributorId: 'user-123',
			}) as any,
		);

		assignCommand.action({} as any, {} as any);

		expect(mockedUlid).not.toHaveBeenCalled();

		expect(mockedMaterializeAndPersist).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersist).toHaveBeenCalledWith({
			action: 'assign.issue',
			payload: {
				targetId: 'ticket-1',
				contributorId: 'user-123',
			},
		});
	});

	it('creates a new contributor when none exists, then assigns the ticket', () => {
		mockedUlid.mockReturnValue('new-contributor-id');

		mockedMaterializeAndPersist
			.mockReturnValueOnce(
				succeeded('Created contributor', 'new-contributor-id') as any,
			)
			.mockReturnValueOnce(
				succeeded('Assigned issue', {
					targetId: 'ticket-1',
					contributorId: 'new-contributor-id',
				}) as any,
			);

		assignCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersist).toHaveBeenNthCalledWith(1, {
			action: 'create.contributor',
			payload: {
				id: 'new-contributor-id',
				name: 'alice',
			},
		});
		expect(mockedMaterializeAndPersist).toHaveBeenNthCalledWith(2, {
			action: 'assign.issue',
			payload: {
				targetId: 'ticket-1',
				contributorId: 'new-contributor-id',
			},
		});
	});

	it('fails when no selected node exists', () => {
		mockedGetOrderedChildren.mockReturnValue([]);

		const result = assignCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Selection node not found'));
		expect(mockedMaterializeAndPersist).not.toHaveBeenCalled();
	});
});
