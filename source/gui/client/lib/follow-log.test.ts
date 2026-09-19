import {describe, expect, it} from 'vitest';
import {LogEntry} from './event-log';
import {followStep, NOT_FOLLOWING} from './follow-log';

const line = (id: string, over: Partial<LogEntry> = {}): LogEntry => ({
	id,
	t: 1,
	label: 'filed a ticket',
	color: '#fff',
	actor: null,
	diff: null,
	issue: 'ISSUE_1',
	action: 'add.issue',
	sha: null,
	...over,
});

const pinned = true;

describe('followStep', () => {
	// Switching on is not a request to go wherever the log is standing.
	it('opens nothing on the first look, and remembers where the log stands', () => {
		const step = followStep({
			entries: [line('a')],
			newestId: 'a',
			mark: NOT_FOLLOWING,
			pinned,
		});

		expect(step.open).toBeNull();
		expect(step.mark).toEqual({line: 'a', went: null});
	});

	it('opens the line that arrives after it', () => {
		const step = followStep({
			entries: [line('a'), line('b', {issue: 'ISSUE_2'})],
			newestId: 'b',
			mark: {line: 'a', went: null},
			pinned,
		});

		expect(step.open).toEqual({
			kind: 'ticket',
			issueId: 'ISSUE_2',
			tab: 'overview',
		});
	});

	// The burst is the diff, so it is one move rather than a walk through it.
	it('opens the newest of a burst, not each of them', () => {
		const step = followStep({
			entries: [
				line('a'),
				line('b', {issue: 'ISSUE_2'}),
				line('c', {issue: 'ISSUE_3'}),
			],
			newestId: 'c',
			mark: {line: 'a', went: null},
			pinned,
		});

		expect(step.open).toMatchObject({issueId: 'ISSUE_3'});
	});

	// Scrolled back the reader is reading, and the pane already refuses to pull
	// itself to the foot. Following obeys the same rule rather than a second one.
	it('opens nothing while the reader has scrolled back', () => {
		const step = followStep({
			entries: [line('a'), line('b', {issue: 'ISSUE_2'})],
			newestId: 'b',
			mark: {line: 'a', went: null},
			pinned: false,
		});

		expect(step.open).toBeNull();
		// And the line is not banked, so it is still followed on the way back.
		expect(step.mark).toEqual({line: 'a', went: null});
	});

	// Board- and swimlane-level lines lead nowhere by definition.
	it('skips past a line that leads nowhere, to the newest that does not', () => {
		const step = followStep({
			entries: [
				line('a'),
				line('b', {issue: 'ISSUE_2'}),
				line('c', {issue: null, action: 'add.swimlane'}),
			],
			newestId: 'c',
			mark: {line: 'a', went: null},
			pinned,
		});

		expect(step.open).toMatchObject({issueId: 'ISSUE_2'});
	});

	// A burst of nothing-lines must not leave following waiting to be told again.
	it('banks a burst that leads nowhere at all', () => {
		const step = followStep({
			entries: [line('a', {issue: null, action: 'add.board'})],
			newestId: 'a',
			mark: {line: 'z', went: null},
			pinned,
		});

		expect(step.open).toBeNull();
		expect(step.mark.line).toBe('a');
	});

	// The reader is already there; a run of edits on the open ticket would
	// otherwise re-open it on every one.
	it('does not open the destination it last opened', () => {
		const first = followStep({
			entries: [line('a'), line('b', {issue: 'ISSUE_2'})],
			newestId: 'b',
			mark: {line: 'a', went: null},
			pinned,
		});

		const second = followStep({
			entries: [
				line('a'),
				line('b', {issue: 'ISSUE_2'}),
				line('c', {issue: 'ISSUE_2', action: 'edit.issue.title'}),
			],
			newestId: 'c',
			mark: first.mark,
			pinned,
		});

		expect(second.open).toBeNull();
		// Banked even so, or the next line is measured against a stale one.
		expect(second.mark.line).toBe('c');
	});

	// A comment opens among the comments, which is a different destination on
	// the same ticket — so it is opened even though the ticket has not changed.
	it('opens the same ticket again when the tab it wants differs', () => {
		const step = followStep({
			entries: [line('a', {issue: 'ISSUE_2', action: 'add.issue.comment'})],
			newestId: 'a',
			mark: {
				line: 'z',
				went: JSON.stringify({
					kind: 'ticket',
					issueId: 'ISSUE_2',
					tab: 'overview',
				}),
			},
			pinned,
		});

		expect(step.open).toMatchObject({tab: 'comments'});
	});

	it('opens a commit line at its diff', () => {
		const step = followStep({
			entries: [line('a', {sha: 'abc123', issue: null, action: null})],
			newestId: 'a',
			mark: {line: 'z', went: null},
			pinned,
		});

		expect(step.open).toEqual({kind: 'commit', sha: 'abc123'});
	});
});
