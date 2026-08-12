import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('ulid', () => ({
	monotonicFactory: () => () => 'generated-id',
	ulid: vi.fn(),
}));

vi.mock('../lib/event/event-materialize-and-persist.js', () => ({
	materializeAndPersistAll: vi.fn(),
}));

vi.mock('../lib/event/event-persist.js', () => ({
	resolveActorId: vi.fn(() => ({
		status: 'success',
		message: 'Resolved actor id',
		value: {userId: '0001', userName: 'jola'},
	})),
}));

vi.mock('../lib/storage/paths.js', () => ({
	getPersistRoot: vi.fn(() =>
		Promise.resolve({
			status: 'success',
			message: 'Resolved persist root',
			value: '/repo/.epiq',
		}),
	),
	getGlobalConfigDir: vi.fn(() => '/home/test/.epiq-global'),
}));

vi.mock('../lib/repository/node-repo.js', () => ({
	findAncestor: vi.fn(),
}));

vi.mock('../lib/repository/rank.js', async importOriginal => {
	const actual = await importOriginal<
		typeof import('../lib/repository/rank.js')
	>();

	return {
		...actual,
		resolveAndPersistRankForMove: vi.fn(() => succeeded('Resolved rank', 'm0')),
	};
});

vi.mock('../lib/state/cmd.state.js', () => ({
	getCmdArg: vi.fn(),
	getCmdState: vi.fn(),
	replaceCmdInput: vi.fn(),
}));

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(),
	patchState: vi.fn(),
	updateState: vi.fn(),
	getRenderedChildren: vi.fn(() => []),
}));

vi.mock('../lib/state/settings.state.js', () => ({
	getSettingsState: vi.fn(() => ({
		autoSync: false,
		userId: '0001',
		userName: 'jola',
	})),
	patchSettingsState: vi.fn(),
}));

vi.mock('../git/auto-sync.js', () => ({
	MIN_AUTOSYNC_DURATION_MS: 1000,
	queueAutoSync: vi.fn(),
}));

import {ulid} from 'ulid';
import {CmdIntent} from '../lib/command-line/command-intent.js';
import {commands} from '../lib/command-line/commands.js';
import {materializeAndPersistAll} from '../lib/event/event-materialize-and-persist.js';
import {
	CommandLineActionEntry,
	CommandLineInput,
} from '../lib/model/action-map.model.js';
import {AppState, Tag} from '../lib/model/app-state.model.js';
import {AnyContext, Ticket} from '../lib/model/context.model.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {failed, Result, succeeded} from '../lib/model/result-types.js';
import {findAncestor} from '../lib/repository/node-repo.js';
import {CommandLineState, getCmdState} from '../lib/state/cmd.state.js';
import {getRenderedChildren, getState} from '../lib/state/state.js';

const mockedUlid = vi.mocked(ulid);
const mockedMaterializeAndPersistAll = vi.mocked(materializeAndPersistAll);
const mockedFindAncestor = vi.mocked(findAncestor);
const mockedGetRenderedChildren = vi.mocked(getRenderedChildren);
const mockedGetCmdState = vi.mocked(getCmdState);
const mockedGetState = vi.mocked(getState);

const tagCommand = commands.find(x => x.intent === CmdIntent.TagTicket)!;
const assignCommand = commands.find(
	x => x.intent === CmdIntent.AssignUserToTicket,
)!;

const ticket: Partial<Ticket> = {
	id: 'ticket-1',
	context: 'TICKET',
	props: {
		tags: [],
		assignees: [],
	},
};

describe('TagTicket command', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		mockedGetCmdState.mockReturnValue({
			commandMeta: {
				modifier: 'bug',
				inputString: '',
			},
		} as CommandLineState);

		mockedGetState.mockReturnValue({
			selectedNode: {id: 'selected-node'},
			tags: {},
			contributors: {},
		} as AppState);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', ticket) as Result<Ticket>,
		);

		mockedMaterializeAndPersistAll.mockReturnValue(
			succeeded('Persisted events', [
				{
					action: 'add.issue.tag',
					result: {tag: 'tag-123'},
				},
			]) as ReturnType<typeof materializeAndPersistAll>,
		);
	});

	it('reuses an existing tag id and adds tag to issue props', async () => {
		mockedGetState.mockReturnValue({
			selectedNode: {id: 'selected-node'} as NavNode<AnyContext>,
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'} as Tag,
			},
			contributors: {},
		} as Partial<AppState> as AppState);

		mockedUlid.mockReturnValueOnce('add-tag-event-id');

		await tagCommand.action(
			{} as CommandLineActionEntry,
			{} as CommandLineInput,
		);

		expect(mockedUlid).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersistAll).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersistAll).toHaveBeenCalledWith(
			[
				{
					id: 'add-tag-event-id',
					userName: 'jola',
					userId: '0001',
					action: 'add.issue.tag',
					payload: {
						id: 'ticket-1',
						tag: 'tag-123',
					},
				},
			],
			'/repo/.epiq',
		);
	});

	it('creates a new tag when none exists, then adds it to issue props', async () => {
		mockedUlid
			.mockReturnValueOnce('new-tag-id')
			.mockReturnValueOnce('create-tag-event-id')
			.mockReturnValueOnce('add-tag-event-id');

		await tagCommand.action(
			{} as CommandLineActionEntry,
			{} as CommandLineInput,
		);

		expect(mockedUlid).toHaveBeenCalledTimes(3);

		expect(mockedMaterializeAndPersistAll).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersistAll).toHaveBeenCalledWith(
			[
				{
					id: 'create-tag-event-id',
					userName: 'jola',
					userId: '0001',
					action: 'create.tag',
					payload: {
						id: 'new-tag-id',
						name: 'bug',
					},
				},
				{
					id: 'add-tag-event-id',
					userName: 'jola',
					userId: '0001',
					action: 'add.issue.tag',
					payload: {
						id: 'ticket-1',
						tag: 'new-tag-id',
					},
				},
			],
			'/repo/.epiq',
		);
	});

	it('tags the ticket id, not the selected child id', async () => {
		mockedGetState.mockReturnValue({
			selectedNode: {id: 'description-field-id'} as NavNode<AnyContext>,
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'},
			},
			contributors: {},
		} as Partial<AppState> as AppState);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {
				...ticket,
				id: 'ticket-99',
			}) as Result<Ticket>,
		);

		mockedUlid.mockReturnValueOnce('add-tag-event-id');

		await tagCommand.action(
			{} as CommandLineActionEntry,
			{} as CommandLineInput,
		);

		expect(mockedMaterializeAndPersistAll).toHaveBeenCalledWith(
			[
				{
					id: 'add-tag-event-id',
					userName: 'jola',
					userId: '0001',
					action: 'add.issue.tag',
					payload: {
						id: 'ticket-99',
						tag: 'tag-123',
					},
				},
			],
			'/repo/.epiq',
		);
	});

	it('fails and does not create duplicate tag', async () => {
		mockedGetState.mockReturnValue({
			selectedNode: {id: 'selected-node'} as NavNode<AnyContext>,
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'} as Tag,
			},
			contributors: {},
		} as Partial<AppState> as AppState);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {
				...ticket,
				props: {
					tags: ['tag-123'],
					assignees: [],
				},
			}) as Result<Ticket>,
		);

		const result = await tagCommand.action(
			{} as CommandLineActionEntry,
			{} as CommandLineInput,
		);

		expect(result).toEqual(failed('Already tagged with that tag'));
		expect(mockedMaterializeAndPersistAll).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
	});

	it('fails when no selected node exists', async () => {
		mockedGetState.mockReturnValue({
			selectedNode: null,
			tags: {},
			contributors: {},
		} as Partial<AppState> as AppState);

		const result = await tagCommand.action(
			{} as CommandLineActionEntry,
			{} as CommandLineInput,
		);

		expect(result).toEqual(failed('Invalid tag target'));
		expect(mockedMaterializeAndPersistAll).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
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
		} as CommandLineState);

		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			contextNode: {id: 'current-node'},
			tags: {},
			contributors: {},
		} as Partial<AppState> as AppState);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', ticket) as Result<Ticket>,
		);

		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node')
				return [{id: 'selected-node'}] as NavNode<AnyContext>[];
			return [] as NavNode<AnyContext>[];
		});

		mockedMaterializeAndPersistAll.mockReturnValue(
			succeeded('Persisted events', [
				{
					action: 'add.issue.assignee',
					result: {assignee: 'user-123'},
				},
			]) as ReturnType<typeof materializeAndPersistAll>,
		);
	});

	it('reuses an existing contributor id and adds assignee to issue props', async () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			contextNode: {id: 'current-node'} as NavNode<AnyContext>,
			tags: {},
			contributors: {
				'user-123': {id: 'user-123', name: 'alice'},
			},
		} as Partial<AppState> as AppState);

		mockedUlid.mockReturnValueOnce('add-assignee-event-id');

		await assignCommand.action(
			{} as CommandLineActionEntry,
			{} as CommandLineInput,
		);

		expect(mockedUlid).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersistAll).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersistAll).toHaveBeenCalledWith(
			[
				{
					id: 'add-assignee-event-id',
					userName: 'jola',
					userId: '0001',
					action: 'add.issue.assignee',
					payload: {
						id: 'ticket-1',
						assignee: 'user-123',
					},
				},
			],
			'/repo/.epiq',
		);
	});

	it('creates a new contributor when none exists, then adds assignee to issue props', async () => {
		mockedUlid
			.mockReturnValueOnce('new-contributor-id')
			.mockReturnValueOnce('create-contributor-event-id')
			.mockReturnValueOnce('add-assignee-event-id');

		await assignCommand.action(
			{} as CommandLineActionEntry,
			{} as CommandLineInput,
		);

		expect(mockedUlid).toHaveBeenCalledTimes(3);

		expect(mockedMaterializeAndPersistAll).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersistAll).toHaveBeenCalledWith(
			[
				{
					id: 'create-contributor-event-id',
					userName: 'jola',
					userId: '0001',
					action: 'create.contributor',
					payload: {
						id: 'new-contributor-id',
						name: 'alice',
					},
				},
				{
					id: 'add-assignee-event-id',
					userName: 'jola',
					userId: '0001',
					action: 'add.issue.assignee',
					payload: {
						id: 'ticket-1',
						assignee: 'new-contributor-id',
					},
				},
			],
			'/repo/.epiq',
		);
	});

	it('fails and does not create duplicate assignment', async () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			contextNode: {id: 'current-node'} as NavNode<AnyContext>,
			tags: {},
			contributors: {
				'user-123': {id: 'user-123', name: 'alice'},
			},
		} as Partial<AppState> as AppState);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {
				...ticket,
				props: {
					tags: [],
					assignees: ['user-123'],
				},
			}) as Result<Ticket>,
		);

		const result = await assignCommand.action(
			{} as CommandLineActionEntry,
			{} as CommandLineInput,
		);

		expect(result).toEqual(failed('Assignee already assigned'));
		expect(mockedMaterializeAndPersistAll).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
	});

	it('fails when no selected node exists', async () => {
		mockedGetRenderedChildren.mockImplementation(() => []);

		const result = await assignCommand.action(
			{} as CommandLineActionEntry,
			{} as CommandLineInput,
		);

		expect(result).toEqual(failed('Invalid assign target'));
		expect(mockedMaterializeAndPersistAll).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
	});
});
