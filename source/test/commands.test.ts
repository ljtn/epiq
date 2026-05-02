import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('ulid', () => ({
	monotonicFactory: () => () => 'generated-id',
	ulid: vi.fn(),
}));

vi.mock('../lib/event/event-materialize-and-persist.js', () => ({
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
	nodeRepo: {
		getFieldByTitle: vi.fn(),
	},
}));

vi.mock('../lib/repository/rank.js', () => ({
	getOrderedChildren: vi.fn(),
}));

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
import {materializeAndPersist} from '../lib/event/event-materialize-and-persist.js';
import {findAncestor, nodeRepo} from '../lib/repository/node-repo.js';
import {getCmdState} from '../lib/state/cmd.state.js';
import {getRenderedChildren, getState} from '../lib/state/state.js';
import {CmdIntent} from '../lib/command-line/command-meta.js';
import {failed, Result, succeeded} from '../lib/model/result-types.js';
import {commands} from '../lib/command-line/commands.js';

const mockedUlid = vi.mocked(ulid);
const mockedMaterializeAndPersist = vi.mocked(materializeAndPersist);
const mockedFindAncestor = vi.mocked(findAncestor);
const mockedGetRenderedChildren = vi.mocked(getRenderedChildren);
const mockedGetCmdState = vi.mocked(getCmdState);
const mockedGetState = vi.mocked(getState);
const mockedNodeRepo = vi.mocked(nodeRepo);

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

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {id: 'ticket-1'}) as any,
		);

		mockedNodeRepo.getFieldByTitle.mockReturnValue({
			id: 'tags-field-1',
			title: 'Tags',
		} as any);

		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [{id: 'selected-node'}] as any;
			if (parentId === 'tags-field-1') return [] as any;
			return [] as any;
		});
	});

	it('reuses an existing tag id and creates a tag-assignment node', () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'},
			},
			contributors: {},
		} as any);

		mockedUlid
			.mockReturnValueOnce('tag-issue-event-id')
			.mockReturnValueOnce('tag-assignment-node-id');

		mockedMaterializeAndPersist.mockReturnValue(
			succeeded('Tagged issue', {
				result: {id: 'tag-assignment-node-id'},
			}) as any,
		);

		tagCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(2);
		expect(mockedMaterializeAndPersist).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersist).toHaveBeenCalledWith({
			id: 'tag-issue-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'tag.issue',
			payload: {
				id: 'tag-assignment-node-id',
				target: 'ticket-1',
				tagId: 'tag-123',
			},
		});
	});

	it('creates a new tag when none exists, then creates a tag-assignment node', () => {
		mockedUlid
			.mockReturnValueOnce('new-tag-id')
			.mockReturnValueOnce('create-tag-event-id')
			.mockReturnValueOnce('tag-issue-event-id')
			.mockReturnValueOnce('new-tag-assignment-node-id');

		mockedMaterializeAndPersist
			.mockReturnValueOnce(
				succeeded('Created tag', {
					result: {id: 'new-tag-id'},
				}) as any,
			)
			.mockReturnValueOnce(
				succeeded('Tagged issue', {
					result: {id: 'new-tag-assignment-node-id'},
				}) as any,
			);

		tagCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(4);

		expect(mockedMaterializeAndPersist).toHaveBeenNthCalledWith(1, {
			id: 'create-tag-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'create.tag',
			payload: {
				id: 'new-tag-id',
				name: 'bug',
			},
		});

		expect(mockedMaterializeAndPersist).toHaveBeenNthCalledWith(2, {
			id: 'tag-issue-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'tag.issue',
			payload: {
				id: 'new-tag-assignment-node-id',
				target: 'ticket-1',
				tagId: 'new-tag-id',
			},
		});
	});

	it('tags the ticket id, not the selected child id', () => {
		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node')
				return [{id: 'description-field-id'}] as any;
			if (parentId === 'tags-field-1') return [] as any;
			return [] as any;
		});

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

		mockedUlid
			.mockReturnValueOnce('tag-issue-event-id')
			.mockReturnValueOnce('tag-assignment-node-id');

		mockedMaterializeAndPersist.mockReturnValue(
			succeeded('Tagged issue', {
				result: {id: 'tag-assignment-node-id'},
			}) as any,
		);

		tagCommand.action({} as any, {} as any);

		expect(mockedMaterializeAndPersist).toHaveBeenCalledWith({
			id: 'tag-issue-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'tag.issue',
			payload: {
				id: 'tag-assignment-node-id',
				target: 'ticket-99',
				tagId: 'tag-123',
			},
		});
	});

	it('returns success and does not create a duplicate tag-assignment node', () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {
				'tag-123': {id: 'tag-123', name: 'bug'},
			},
			contributors: {},
		} as any);

		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [{id: 'selected-node'}] as any;
			if (parentId === 'tags-field-1')
				return [{id: 'existing-tag-node', props: {value: 'tag-123'}}] as any;
			return [] as any;
		});

		const result = tagCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Already tagged with that tag'));
		expect(mockedMaterializeAndPersist).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
	});

	it('fails when no selected node exists', () => {
		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [] as any;
			return [] as any;
		});

		const result = tagCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Invalid tag target'));
		expect(mockedMaterializeAndPersist).not.toHaveBeenCalled();
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
			succeeded('Found ticket', {id: 'ticket-1'}) as any,
		);

		mockedNodeRepo.getFieldByTitle.mockReturnValue({
			id: 'assignees-field-1',
			title: 'Assignees',
		} as any);

		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [{id: 'selected-node'}] as any;
			if (parentId === 'assignees-field-1') return [] as any;
			return [] as any;
		});
	});

	it('reuses an existing contributor id and creates an assignment node', () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {},
			contributors: {
				'user-123': {id: 'user-123', name: 'alice'},
			},
		} as any);

		mockedUlid
			.mockReturnValueOnce('assign-issue-event-id')
			.mockReturnValueOnce('assignment-node-id');

		mockedMaterializeAndPersist.mockReturnValue(
			succeeded('Assigned issue', {
				result: {id: 'assignment-node-id'},
			}) as any,
		);

		assignCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(2);
		expect(mockedMaterializeAndPersist).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersist).toHaveBeenCalledWith({
			id: 'assign-issue-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'assign.issue',
			payload: {
				id: 'assignment-node-id',
				target: 'ticket-1',
				contributor: 'user-123',
			},
		});
	});

	it('creates a new contributor when none exists, then creates an assignment node', () => {
		mockedUlid
			.mockReturnValueOnce('new-contributor-id')
			.mockReturnValueOnce('create-contributor-event-id')
			.mockReturnValueOnce('assign-issue-event-id')
			.mockReturnValueOnce('new-assignment-node-id');

		mockedMaterializeAndPersist
			.mockReturnValueOnce(
				succeeded('Created contributor', {
					result: {id: 'new-contributor-id'},
				}) as any,
			)
			.mockReturnValueOnce(
				succeeded('Assigned issue', {
					result: {id: 'new-assignment-node-id'},
				}) as any,
			);

		assignCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(4);

		expect(mockedMaterializeAndPersist).toHaveBeenNthCalledWith(1, {
			id: 'create-contributor-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'create.contributor',
			payload: {
				id: 'new-contributor-id',
				name: 'alice',
			},
		});

		expect(mockedMaterializeAndPersist).toHaveBeenNthCalledWith(2, {
			id: 'assign-issue-event-id',
			userName: 'jola',
			userId: '0001',
			action: 'assign.issue',
			payload: {
				id: 'new-assignment-node-id',
				target: 'ticket-1',
				contributor: 'new-contributor-id',
			},
		});
	});

	it('returns success and does not create a duplicate assignment node', () => {
		mockedGetState.mockReturnValue({
			selectedIndex: 0,
			currentNode: {id: 'current-node'},
			tags: {},
			contributors: {
				'user-123': {id: 'user-123', name: 'alice'},
			},
		} as any);

		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [{id: 'selected-node'}] as any;
			if (parentId === 'assignees-field-1')
				return [
					{id: 'existing-assignment-node', props: {value: 'user-123'}},
				] as any;
			return [] as any;
		});

		const result = assignCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Assignee already assigned'));
		expect(mockedMaterializeAndPersist).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
	});

	it('fails when no selected node exists', () => {
		mockedGetRenderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [] as any;
			return [] as any;
		});

		const result = assignCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Invalid assign target'));
		expect(mockedMaterializeAndPersist).not.toHaveBeenCalled();
		expect(mockedUlid).not.toHaveBeenCalled();
	});
});
