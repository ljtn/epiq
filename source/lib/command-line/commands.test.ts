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
	nodeRepo: {
		getFieldByTitle: vi.fn(),
	},
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
import {findAncestor, nodeRepo} from '../../repository/node-repo.js';
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

		mockedGetOrderedChildren.mockImplementation((parentId: string) => {
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

		mockedUlid.mockReturnValue('tag-assignment-node-id');

		mockedMaterializeAndPersist.mockReturnValue(
			succeeded('Tagged issue', {
				id: 'tag-assignment-node-id',
				parentNodeId: 'tags-field-1',
				props: {value: 'tag-123'},
			}) as any,
		);

		tagCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(1);

		expect(mockedMaterializeAndPersist).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersist).toHaveBeenCalledWith({
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
			.mockReturnValueOnce('new-tag-assignment-node-id');

		mockedMaterializeAndPersist
			.mockReturnValueOnce(succeeded('Created tag', 'new-tag-id') as any)
			.mockReturnValueOnce(
				succeeded('Tagged issue', {
					id: 'new-tag-assignment-node-id',
					parentNodeId: 'tags-field-1',
					props: {value: 'new-tag-id'},
				}) as any,
			);

		tagCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(2);
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
				id: 'new-tag-assignment-node-id',
				target: 'ticket-1',
				tagId: 'new-tag-id',
			},
		});
	});

	it('tags the ticket id, not the selected child id', () => {
		mockedGetOrderedChildren.mockImplementation((parentId: string) => {
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

		mockedUlid.mockReturnValue('tag-assignment-node-id');

		mockedMaterializeAndPersist.mockReturnValue(
			succeeded('Tagged issue', {
				id: 'tag-assignment-node-id',
				parentNodeId: 'tags-field-1',
				props: {value: 'tag-123'},
			}) as any,
		);

		tagCommand.action({} as any, {} as any);

		expect(mockedMaterializeAndPersist).toHaveBeenCalledWith({
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

		mockedGetOrderedChildren.mockImplementation((parentId: string) => {
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
		mockedGetOrderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [] as any;
			return [] as any;
		});

		const result = tagCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Invalid tag target'));
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

		mockedFindAncestor.mockReturnValue(
			succeeded('Found ticket', {id: 'ticket-1'}) as any,
		);

		mockedNodeRepo.getFieldByTitle.mockReturnValue({
			id: 'assignees-field-1',
			title: 'Assignees',
		} as any);

		mockedGetOrderedChildren.mockImplementation((parentId: string) => {
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

		mockedUlid.mockReturnValue('assignment-node-id');

		mockedMaterializeAndPersist.mockReturnValue(
			succeeded('Assigned issue', {
				id: 'assignment-node-id',
				parentNodeId: 'assignees-field-1',
				props: {value: 'user-123'},
			}) as any,
		);

		assignCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(1);

		expect(mockedMaterializeAndPersist).toHaveBeenCalledTimes(1);
		expect(mockedMaterializeAndPersist).toHaveBeenCalledWith({
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
			.mockReturnValueOnce('new-assignment-node-id');

		mockedMaterializeAndPersist
			.mockReturnValueOnce(
				succeeded('Created contributor', 'new-contributor-id') as any,
			)
			.mockReturnValueOnce(
				succeeded('Assigned issue', {
					id: 'new-assignment-node-id',
					parentNodeId: 'assignees-field-1',
					props: {value: 'new-contributor-id'},
				}) as any,
			);

		assignCommand.action({} as any, {} as any);

		expect(mockedUlid).toHaveBeenCalledTimes(2);
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

		mockedGetOrderedChildren.mockImplementation((parentId: string) => {
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
		mockedGetOrderedChildren.mockImplementation((parentId: string) => {
			if (parentId === 'current-node') return [] as any;
			return [] as any;
		});

		const result = assignCommand.action({} as any, {} as any);

		expect(result).toEqual(failed('Invalid assign target'));
		expect(mockedMaterializeAndPersist).not.toHaveBeenCalled();
	});
});
