import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('ulid', () => ({
	monotonicFactory: () => () => 'generated-id',
	ulid: vi.fn(),
}));

vi.mock('../lib/event/event-materialize-and-persist.js', () => ({
	persistEvent: vi.fn(),
	materializeAndPersist: vi.fn(),
	materializeAndPersistAll: vi.fn(),
}));

vi.mock('../lib/event/event-persist.js', () => ({
	resolveActorId: vi.fn(
		() =>
			({
				status: 'success',
				message: 'Resolved actor id',
				value: {userId: '0001', userName: 'jola'},
			} satisfies Result),
	),
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
}));

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(),
	patchState: vi.fn(),
	updateState: vi.fn(),
	getRenderedChildren: vi.fn(() => []),
}));

import {ulid} from 'ulid';
import {CmdIntent} from '../lib/command-line/command-intent.js';
import {commands} from '../lib/command-line/commands.js';
import {persistEvent} from '../lib/event/event-materialize-and-persist.js';
import {failed, Result, succeeded} from '../lib/model/result-types.js';
import {findAncestor} from '../lib/repository/node-repo.js';
import {getCmdState} from '../lib/state/cmd.state.js';
import {getRenderedChildren, getState} from '../lib/state/state.js';

const mockedUlid = vi.mocked(ulid);
const mockedPersistEvent = vi.mocked(persistEvent);
const mockedFindAncestor = vi.mocked(findAncestor);
const mockedGetRenderedChildren = vi.mocked(getRenderedChildren);
const mockedGetCmdState = vi.mocked(getCmdState);
const mockedGetState = vi.mocked(getState);

const tagCommand = commands.find(x => x.intent === CmdIntent.TagTicket)!;
const assignCommand = commands.find(
	x => x.intent === CmdIntent.AssignUserToTicket,
)!;

const ticket = {
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
		} as any);

		mockedGetState.mockReturnValue({
			selectedNode: {id: 'selected-node'},
			tags: {},
			contributors: {},
		} as any);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', ticket) as any,
		);

		mockedPersistEvent.mockReturnValue(
			succeeded('Persisted event', {
				result: {id: 'result-id'},
			}) as any,
		);
	});

	it('reuses an existing tag id and adds tag to issue props', async () => {
		mockedGetState.mockReturnValue({
			selectedNode: {id: 'selected-node'},
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'},
			},
			contributors: {},
		} as any);

		mockedUlid.mockReturnValueOnce('add-tag-event-id');

		await tagCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(1);
		expect(mockedPersistEvent).toHaveBeenCalledTimes(1);
		expect(mockedPersistEvent).toHaveBeenCalledWith({
			id: 'add-tag-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'add.issue.tag',
			payload: {
				id: 'ticket-1',
				tag: 'tag-123',
			},
		});
	});

	it('creates a new tag when none exists, then adds it to issue props', async () => {
		mockedUlid
			.mockReturnValueOnce('new-tag-id')
			.mockReturnValueOnce('create-tag-event-id')
			.mockReturnValueOnce('add-tag-event-id');

		mockedPersistEvent
			.mockReturnValueOnce(
				succeeded('Created tag', {
					result: {id: 'new-tag-id'},
				}) as any,
			)
			.mockReturnValueOnce(
				succeeded('Tagged issue', {
					result: {tag: 'new-tag-id'},
				}) as any,
			);

		await tagCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(3);

		expect(mockedPersistEvent).toHaveBeenNthCalledWith(1, {
			id: 'create-tag-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'create.tag',
			payload: {
				id: 'new-tag-id',
				name: 'bug',
			},
		});

		expect(mockedPersistEvent).toHaveBeenNthCalledWith(2, {
			id: 'add-tag-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'add.issue.tag',
			payload: {
				id: 'ticket-1',
				tag: 'new-tag-id',
			},
		});
	});

	it('tags the ticket id, not the selected child id', async () => {
		mockedGetState.mockReturnValue({
			selectedNode: {id: 'description-field-id'},
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'},
			},
			contributors: {},
		} as any);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {
				...ticket,
				id: 'ticket-99',
			}) as any,
		);

		mockedUlid.mockReturnValueOnce('add-tag-event-id');

		await tagCommand.action({} as any, {} as any);

		expect(mockedPersistEvent).toHaveBeenCalledWith({
			id: 'add-tag-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'add.issue.tag',
			payload: {
				id: 'ticket-99',
				tag: 'tag-123',
			},
		});
	});

	it('fails and does not create duplicate tag', async () => {
		mockedGetState.mockReturnValue({
			selectedNode: {id: 'selected-node'},
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'},
			},
			contributors: {},
		} as any);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {
				...ticket,
				props: {
					tags: ['tag-123'],
					assignees: [],
				},
			}) as any,
		);

		const result = await tagCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Already tagged with that tag'));
		expect(mockedPersistEvent).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
	});

	it('fails when no selected node exists', async () => {
		mockedGetState.mockReturnValue({
			selectedNode: null,
			tags: {},
			contributors: {},
		} as any);

		const result = await tagCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Invalid tag target'));
		expect(mockedPersistEvent).not.toHaveBeenCalled();
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
		} as any);

		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {},
			contributors: {},
		} as any);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', ticket) as any,
		);

		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [{id: 'selected-node'}] as any;
			return [] as any;
		});

		mockedPersistEvent.mockReturnValue(
			succeeded('Persisted event', {
				result: {id: 'result-id'},
			}) as any,
		);
	});

	it('reuses an existing contributor id and adds assignee to issue props', async () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {},
			contributors: {
				'user-123': {id: 'user-123', name: 'alice'},
			},
		} as any);

		mockedUlid.mockReturnValueOnce('add-assignee-event-id');

		await assignCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(1);
		expect(mockedPersistEvent).toHaveBeenCalledTimes(1);
		expect(mockedPersistEvent).toHaveBeenCalledWith({
			id: 'add-assignee-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'add.issue.assignee',
			payload: {
				id: 'ticket-1',
				assignee: 'user-123',
			},
		});
	});

	it('creates a new contributor when none exists, then adds assignee to issue props', async () => {
		mockedUlid
			.mockReturnValueOnce('new-contributor-id')
			.mockReturnValueOnce('create-contributor-event-id')
			.mockReturnValueOnce('add-assignee-event-id');

		mockedPersistEvent
			.mockReturnValueOnce(
				succeeded('Created contributor', {
					result: {id: 'new-contributor-id'},
				}) as any,
			)
			.mockReturnValueOnce(
				succeeded('Assigned issue', {
					result: {assignee: 'new-contributor-id'},
				}) as any,
			);

		await assignCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(3);

		expect(mockedPersistEvent).toHaveBeenNthCalledWith(1, {
			id: 'create-contributor-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'create.contributor',
			payload: {
				id: 'new-contributor-id',
				name: 'alice',
			},
		});

		expect(mockedPersistEvent).toHaveBeenNthCalledWith(2, {
			id: 'add-assignee-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'add.issue.assignee',
			payload: {
				id: 'ticket-1',
				assignee: 'new-contributor-id',
			},
		});
	});

	it('fails and does not create duplicate assignment', async () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {},
			contributors: {
				'user-123': {id: 'user-123', name: 'alice'},
			},
		} as any);

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {
				...ticket,
				props: {
					tags: [],
					assignees: ['user-123'],
				},
			}) as any,
		);

		const result = await assignCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Assignee already assigned'));
		expect(mockedPersistEvent).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
	});

	it('fails when no selected node exists', async () => {
		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [] as any;
			return [] as any;
		});

		const result = await assignCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Invalid assign target'));
		expect(mockedPersistEvent).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
	});
});
