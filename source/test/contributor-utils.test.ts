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

		// Their real name comes back, not the redaction placeholder path. It is
		// the record's spelling because "removed" is what "Removed" sanitizes
		// to — same name, so the readable one wins.
		expect(getContributorDisplayName('user-1', 'Removed')).toBe('Removed');
	});

	// The regression that motivated `preferBestName`. Log names are parsed out
	// of the event file name, which `sanitizeFilePart` lowercased and
	// hyphenated on the way to disk — so treating the log as authoritative
	// replaced every real name with its storage encoding.
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

		// A rename only ever surfaces in the log, so it has to win — sanitized,
		// which is all the file name can carry, but current.
		expect(getContributorDisplayName('user-1', 'Alice Cooper')).toBe(
			'alicia-cooper',
		);
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

describe('preferBestName', () => {
	// Derives the log-side name the way the app actually produces it, rather
	// than hand-writing what we think sanitizing does. If the encoding ever
	// changes, this fails instead of quietly testing a fiction — which is
	// exactly how the original bug survived its own test suite.
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

	// An empty log name is not "a different name", it is no name at all —
	// events carry no userName when the file name segment was unparseable.
	it('ignores an empty log name', () => {
		expect(preferBestName('Alice', '')).toBe('Alice');
	});
});
