import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(),
}));

import {getState} from '../lib/state/state.js';
import {hasAuthoredEvents} from '../lib/utils/contributor.utils.js';

const mockState = (state: {
	eventLog?: unknown[];
	contributors?: Record<string, unknown>;
}) => vi.mocked(getState).mockReturnValue(state as never);

const authoredAs = (userId: string, userName: string) => ({
	id: `event-${userId}-${userName}`,
	userId,
	userName,
	action: 'edit.title',
	payload: {id: 'issue-1', name: 'x'},
});

describe('hasAuthoredEvents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('is true for anyone who appears as an author', () => {
		mockState({eventLog: [authoredAs('user-1', 'Alice')], contributors: {}});

		expect(hasAuthoredEvents('user-1')).toBe(true);
	});

	it('is false for an assignee who has never authored anything', () => {
		mockState({
			eventLog: [authoredAs('user-1', 'Alice')],
			contributors: {'user-2': {id: 'user-2', name: 'Outsider'}},
		});

		expect(hasAuthoredEvents('user-2')).toBe(false);
	});

	it('counts an author who never carried a name', () => {
		mockState({
			eventLog: [
				{id: 'e', userId: 'user-3', action: 'edit.title', payload: {}},
			],
			contributors: {},
		});

		expect(hasAuthoredEvents('user-3')).toBe(true);
	});

	it('tolerates state read before boot has populated it', () => {
		mockState({});

		expect(hasAuthoredEvents('user-1')).toBe(false);
	});

	// The index is keyed on array identity, which is only safe because
	// materializing replaces the array rather than mutating it.
	it('picks up a new author once the log has been replaced', () => {
		const eventLog = [authoredAs('user-1', 'Alice')];
		mockState({eventLog, contributors: {}});

		expect(hasAuthoredEvents('user-2')).toBe(false);

		mockState({
			eventLog: [...eventLog, authoredAs('user-2', 'Bob')],
			contributors: {},
		});

		expect(hasAuthoredEvents('user-2')).toBe(true);
	});

	it('answers consistently when the same log is read repeatedly', () => {
		const eventLog = [authoredAs('user-1', 'Alice')];
		mockState({eventLog, contributors: {}});

		expect(hasAuthoredEvents('user-1')).toBe(true);
		expect(hasAuthoredEvents('user-1')).toBe(true);
	});
});
