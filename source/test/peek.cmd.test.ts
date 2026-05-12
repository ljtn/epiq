import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../git/git-storage.js', () => ({
	getRepoRootDir: vi.fn(),
	getStateBranchRoot: vi.fn(),
}));

vi.mock('../lib/actions/default/navigation-action-utils.js', () => ({
	navigationUtils: {
		navigate: vi.fn(),
	},
}));

vi.mock('../lib/event/event-load.js', () => ({
	loadMergedEvents: vi.fn(),
	loadMergedEventsBefore: vi.fn(),
}));

vi.mock('../lib/event/event-materialize.js', () => ({
	materializeAll: vi.fn(),
}));

vi.mock('../lib/model/app-state.model.js', () => ({
	findInBreadCrumb: vi.fn(),
}));

vi.mock('../lib/state/cmd.state.js', () => ({
	getCmdState: vi.fn(),
}));

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(),
	patchState: vi.fn(),
	resetState: vi.fn(),
}));

vi.mock('../lib/command-line/validate-date.js', () => ({
	parsePeekDateInput: vi.fn(),
}));

import {getRepoRootDir, getStateBranchRoot} from '../git/git-storage.js';

import {navigationUtils} from '../lib/actions/default/navigation-action-utils.js';

import {
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../lib/event/event-load.js';

import {materializeAll} from '../lib/event/event-materialize.js';

import {findInBreadCrumb} from '../lib/model/app-state.model.js';

import {
	failed,
	isFail,
	isSuccess,
	succeeded,
} from '../lib/model/result-types.js';

import {getCmdState} from '../lib/state/cmd.state.js';

import {getState, patchState, resetState} from '../lib/state/state.js';

import {parsePeekDateInput} from '../lib/command-line/validate-date.js';

import {ulid} from 'ulid';
import {peekCommand} from '../lib/command-line/commands/peek.cmd.js';
import {Board} from '../lib/model/context.model.js';

describe('peekCommand', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		vi.mocked(getRepoRootDir).mockResolvedValue(succeeded('repo', '/repo'));

		vi.mocked(getStateBranchRoot).mockReturnValue(
			succeeded('branch', '/repo/.epiq'),
		);

		vi.mocked(findInBreadCrumb).mockReturnValue(
			succeeded('board', {
				id: 'board-1',
			} as Board),
		);

		vi.mocked(resetState).mockReturnValue(succeeded('reset', ''));

		vi.mocked(materializeAll).mockReturnValue([]);

		vi.mocked(getState).mockReturnValue({
			breadCrumb: [],
			eventLog: [],
			unappliedEvents: [],
			nodes: {
				'board-1': {
					id: 'board-1',
				},
			},
		} as never);
	});

	it('returns to live mode with :peek now', async () => {
		vi.mocked(getCmdState).mockReturnValue({
			commandMeta: {
				modifier: 'now',
			},
		} as never);

		vi.mocked(loadMergedEvents).mockReturnValue(
			succeeded('events', [{id: '1'}, {id: '2'}] as never),
		);

		const result = await peekCommand();

		expect(loadMergedEvents).toHaveBeenCalled();

		expect(materializeAll).toHaveBeenCalledWith([{id: '1'}, {id: '2'}]);

		expect(patchState).toHaveBeenCalledWith({
			mode: 'default',
			readOnly: false,
			timeMode: 'live',
			unappliedEvents: [],
		});

		if (isFail(result)) return result;
		expect(isSuccess(result)).toBe(true);
	});

	it('loads historical events for explicit date peek', async () => {
		vi.mocked(getCmdState).mockReturnValue({
			commandMeta: {
				modifier: '1h',
			},
		} as never);

		vi.mocked(parsePeekDateInput).mockReturnValue(new Date(1000));

		vi.mocked(loadMergedEventsBefore).mockReturnValue(
			succeeded('events', {
				appliedEvents: [{id: '1'}],
				unappliedEvents: [{id: '2'}],
			} as never),
		);

		const result = await peekCommand();

		expect(loadMergedEventsBefore).toHaveBeenCalledWith('/repo/.epiq', 1000);

		expect(materializeAll).toHaveBeenCalledWith([{id: '1'}]);

		expect(patchState).toHaveBeenCalledWith({
			mode: 'default',
			readOnly: true,
			timeMode: 'peek',
			unappliedEvents: [{id: '2'}],
		});

		expect(navigationUtils.navigate).toHaveBeenCalled();

		expect(isSuccess(result)).toBe(true);
	});

	it('uses the current last applied event for :peek prev', async () => {
		const previousTime = Date.now() - 1000;
		const previousId = ulid(previousTime);

		vi.mocked(getCmdState).mockReturnValue({
			commandMeta: {
				modifier: 'prev',
			},
		} as never);

		vi.mocked(getState).mockReturnValue({
			breadCrumb: [],
			eventLog: [
				{
					id: previousId,
				},
			],
			unappliedEvents: [],
			nodes: {
				'board-1': {
					id: 'board-1',
				},
			},
		} as never);

		vi.mocked(loadMergedEventsBefore).mockReturnValue(
			succeeded('events', {
				appliedEvents: [],
				unappliedEvents: [],
			} as never),
		);

		await peekCommand();

		expect(loadMergedEventsBefore).toHaveBeenCalledWith(
			'/repo/.epiq',
			previousTime,
		);
	});

	it('uses next unapplied event time plus one for :peek next', async () => {
		const nextTime = Date.now() + 1000;
		const nextId = ulid(nextTime);

		vi.mocked(getCmdState).mockReturnValue({
			commandMeta: {
				modifier: 'next',
			},
		} as never);

		vi.mocked(getState).mockReturnValue({
			breadCrumb: [],
			eventLog: [],
			unappliedEvents: [
				{
					id: nextId,
				},
			],
			nodes: {
				'board-1': {
					id: 'board-1',
				},
			},
		} as never);

		vi.mocked(loadMergedEventsBefore).mockReturnValue(
			succeeded('events', {
				appliedEvents: [],
				unappliedEvents: [],
			} as never),
		);

		await peekCommand();

		expect(loadMergedEventsBefore).toHaveBeenCalledWith(
			'/repo/.epiq',
			nextTime + 1,
		);
	});

	it('restores previous state if materialization fails', async () => {
		const previousState = {
			breadCrumb: [],
			eventLog: [],
			unappliedEvents: [],
			nodes: {},
		};

		vi.mocked(getState).mockReturnValue(previousState as never);

		vi.mocked(getCmdState).mockReturnValue({
			commandMeta: {
				modifier: '1h',
			},
		} as never);

		vi.mocked(parsePeekDateInput).mockReturnValue(new Date(1000));

		vi.mocked(loadMergedEventsBefore).mockReturnValue(
			succeeded('events', {
				appliedEvents: [{id: '1'}],
				unappliedEvents: [],
			} as never),
		);

		vi.mocked(materializeAll).mockReturnValue([failed('boom')]);

		const result = await peekCommand();

		expect(resetState).toHaveBeenCalledTimes(2);

		expect(patchState).toHaveBeenCalledWith(previousState);

		expect(isSuccess(result)).toBe(false);
	});

	it('fails when target board does not exist historically', async () => {
		vi.mocked(getCmdState).mockReturnValue({
			commandMeta: {
				modifier: '1h',
			},
		} as never);

		vi.mocked(parsePeekDateInput).mockReturnValue(new Date(1000));

		vi.mocked(loadMergedEventsBefore).mockReturnValue(
			succeeded('events', {
				appliedEvents: [],
				unappliedEvents: [],
			} as never),
		);

		vi.mocked(getState).mockReturnValue({
			breadCrumb: [],
			eventLog: [],
			unappliedEvents: [],
			nodes: {},
		} as never);

		const result = await peekCommand();

		expect(isSuccess(result)).toBe(false);

		if (isFail(result)) {
			expect(result.message).toContain('Board did not exist at peek date');
		}
	});

	it('fails on invalid peek date', async () => {
		vi.mocked(getCmdState).mockReturnValue({
			commandMeta: {
				modifier: 'bad-date',
			},
		} as never);

		vi.mocked(parsePeekDateInput).mockReturnValue(null);

		const result = await peekCommand();

		expect(isSuccess(result)).toBe(false);

		if (isFail(result)) {
			expect(result.message).toContain('Invalid peek date');
		}
	});
});
