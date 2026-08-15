import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(),
}));

import {getState} from '../lib/state/state.js';
import {
	getContributorDisplayName,
	hasAuthoredEvents,
} from '../lib/utils/contributor.utils.js';

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

describe('getContributorDisplayName', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('falls back to the record for someone with no events', () => {
		mockState({eventLog: [], contributors: {}});

		expect(getContributorDisplayName('user-1', 'Alice')).toBe('Alice');
	});

	it('prefers the log name over a stale record snapshot', () => {
		// The record's name is written once at create.contributor, so a rename
		// only ever shows up in the log.
		mockState({
			eventLog: [authoredAs('user-1', 'Alice Cooper')],
			contributors: {'user-1': {id: 'user-1', name: 'Alice'}},
		});

		expect(getContributorDisplayName('user-1', 'Alice')).toBe('Alice Cooper');
	});

	it('takes the most recent name when someone renamed more than once', () => {
		mockState({
			eventLog: [
				authoredAs('user-1', 'Alice'),
				authoredAs('user-1', 'Alice Cooper'),
			],
			contributors: {'user-1': {id: 'user-1', name: 'Alice'}},
		});

		expect(getContributorDisplayName('user-1', 'Alice')).toBe('Alice Cooper');
	});

	it('ignores names belonging to other contributors', () => {
		mockState({
			eventLog: [authoredAs('user-2', 'Bob')],
			contributors: {},
		});

		expect(getContributorDisplayName('user-1', 'Alice')).toBe('Alice');
	});

	// The regression this file exists for. Redaction cannot remove the name
	// from the log without rewriting history, so the record has to win on the
	// way out — otherwise a sync that brings the person's log file back also
	// brings their name back, and the GUI's "it cannot be restored" is a lie.
	it('keeps a redacted contributor cleared even though the log names them', () => {
		mockState({
			eventLog: [authoredAs('user-1', 'Alice')],
			contributors: {'user-1': {id: 'user-1', name: 'removed', redacted: true}},
		});

		expect(getContributorDisplayName('user-1', 'removed')).toBe('removed');
	});

	it('does not treat somebody genuinely called "removed" as redacted', () => {
		mockState({
			eventLog: [authoredAs('user-1', 'removed')],
			contributors: {'user-1': {id: 'user-1', name: 'Removed'}},
		});

		expect(getContributorDisplayName('user-1', 'Removed')).toBe('removed');
	});

	it('tolerates state read before boot has populated it', () => {
		mockState({});

		expect(getContributorDisplayName('user-1', 'Alice')).toBe('Alice');
	});

	// The log index is memoised on the event log's array identity, so the risk
	// this trades for the speed is a stale answer. Materializing replaces the
	// array (`eventLog: [...s.eventLog, event]`) rather than pushing into it,
	// which is what makes identity a safe key.
	it('picks up a rename once the log has been replaced', () => {
		mockState({
			eventLog: [authoredAs('user-1', 'Alice')],
			contributors: {},
		});
		expect(getContributorDisplayName('user-1', 'fallback')).toBe('Alice');

		mockState({
			eventLog: [authoredAs('user-1', 'Alice'), authoredAs('user-1', 'Alicia')],
			contributors: {},
		});
		expect(getContributorDisplayName('user-1', 'fallback')).toBe('Alicia');
	});

	it('answers consistently when the same log is read repeatedly', () => {
		const eventLog = [authoredAs('user-1', 'Alice')];
		mockState({eventLog, contributors: {}});

		expect(getContributorDisplayName('user-1', 'fallback')).toBe('Alice');
		expect(getContributorDisplayName('user-1', 'fallback')).toBe('Alice');
		expect(hasAuthoredEvents('user-1')).toBe(true);
	});
});

describe('hasAuthoredEvents', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('is true for anyone who appears as an author', () => {
		mockState({eventLog: [authoredAs('user-1', 'Alice')], contributors: {}});

		expect(hasAuthoredEvents('user-1')).toBe(true);
	});

	// The case the marker exists for, and the one that used to scan the whole
	// log with no early exit.
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

		// No userName to index, but they still authored — so not an outsider.
		expect(hasAuthoredEvents('user-3')).toBe(true);
		expect(getContributorDisplayName('user-3', 'Recorded')).toBe('Recorded');
	});

	it('tolerates state read before boot has populated it', () => {
		mockState({});

		expect(hasAuthoredEvents('user-1')).toBe(false);
	});
});
