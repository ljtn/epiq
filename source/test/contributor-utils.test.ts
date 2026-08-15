import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(),
}));

import {getState} from '../lib/state/state.js';
import {
	getContributorDisplayName,
	hasAuthoredEvents,
	preferBestName,
} from '../lib/utils/contributor.utils.js';
import {getPersistFileName} from '../lib/event/event-persist.js';

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
		// The record's name is a write-once snapshot; a rename shows up only in the log.
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

	// The record must win, or a later sync restores a cleared name.
	it('keeps a tombstoned contributor cleared even though the log names them', () => {
		mockState({
			eventLog: [authoredAs('user-1', 'Alice')],
			contributors: {
				'user-1': {id: 'user-1', name: 'removed', tombstoned: true},
			},
		});

		expect(getContributorDisplayName('user-1', 'removed')).toBe('removed');
	});

	it('does not treat somebody genuinely called "removed" as tombstoned', () => {
		mockState({
			eventLog: [authoredAs('user-1', 'removed')],
			contributors: {'user-1': {id: 'user-1', name: 'Removed'}},
		});

		// Same name either way, so the record's spelling wins.
		expect(getContributorDisplayName('user-1', 'Removed')).toBe('Removed');
	});

	// Log names arrive sanitized; treating them as authoritative replaced
	// every real name with its storage encoding.
	it('keeps the record spelling when the log name is only its sanitized form', () => {
		mockState({
			eventLog: [authoredAs('user-1', 'jonatan-lampa')],
			contributors: {'user-1': {id: 'user-1', name: 'Jonatan Lampa'}},
		});

		expect(getContributorDisplayName('user-1', 'Jonatan Lampa')).toBe(
			'Jonatan Lampa',
		);
	});

	it('still takes the log name when it is a genuinely different name', () => {
		mockState({
			eventLog: [authoredAs('user-1', 'alicia-cooper')],
			contributors: {'user-1': {id: 'user-1', name: 'Alice Cooper'}},
		});

		expect(getContributorDisplayName('user-1', 'Alice Cooper')).toBe(
			'alicia-cooper',
		);
	});

	it('tolerates state read before boot has populated it', () => {
		mockState({});

		expect(getContributorDisplayName('user-1', 'Alice')).toBe('Alice');
	});

	// The index is keyed on array identity, which is only safe because
	// materializing replaces the array rather than mutating it.
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
		expect(getContributorDisplayName('user-3', 'Recorded')).toBe('Recorded');
	});

	it('tolerates state read before boot has populated it', () => {
		mockState({});

		expect(hasAuthoredEvents('user-1')).toBe(false);
	});
});

describe('preferBestName', () => {
	// Derive the log name through the real encoder, so a change to it fails
	// here instead of quietly testing a fiction.
	const asLogName = (userName: string) =>
		getPersistFileName({
			userId: '01KSAYRA4GHEKJP888WFBWBRDD',
			userName,
		}).split('.')[1]!;

	it('keeps the record spelling for a name the log only carries encoded', () => {
		expect(preferBestName('Jonatan Lampa', asLogName('Jonatan Lampa'))).toBe(
			'Jonatan Lampa',
		);
	});

	it.each([
		'Jonatan Lampa',
		'ALICE',
		'Bob O Brien',
		'renée dupont',
		'  Padded  Name  ',
	])('round-trips %j back to the record spelling', name => {
		expect(preferBestName(name, asLogName(name))).toBe(name);
	});

	it('takes the log name when it is a different name', () => {
		expect(preferBestName('Alice Cooper', 'alicia-cooper')).toBe(
			'alicia-cooper',
		);
	});

	it('falls back to whichever side is present', () => {
		expect(preferBestName('Alice', undefined)).toBe('Alice');
		expect(preferBestName(undefined, 'alice')).toBe('alice');
		expect(preferBestName(undefined, undefined)).toBeUndefined();
	});

	it('ignores an empty log name', () => {
		expect(preferBestName('Alice', '')).toBe('Alice');
	});
});
