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
	// Switching on shows what following does, rather than waiting for an event
	// to prove it: a mode that announces itself by doing nothing cannot be told
	// from one that is broken.
	it('opens the newest line on the first look, and remembers it', () => {
		const step = followStep({
			entries: [line('a')],
			newestId: 'a',
			mark: NOT_FOLLOWING,
			pinned,
			at: null,
		});

		expect(step.open).toMatchObject({issueId: 'ISSUE_1'});
		expect(step.mark).toEqual({line: 'a'});
	});

	// Unbounded on the first look, unlike every look after it: with no mark
	// there is nothing to stop at, and the newest thing in the window is
	// exactly what the reader is being shown.
	it('reaches back past lines that lead nowhere to find the first one', () => {
		const step = followStep({
			entries: [
				line('a', {issue: 'ISSUE_2'}),
				line('b', {issue: null, action: 'add.swimlane'}),
			],
			newestId: 'b',
			mark: NOT_FOLLOWING,
			pinned,
			at: null,
		});

		expect(step.open).toMatchObject({issueId: 'ISSUE_2'});
	});

	// Pressing the button is the reader asking, where an arrival is not — so
	// the pin, which refuses arrivals while they read back, does not refuse it.
	it('opens on the first look even while the reader has scrolled back', () => {
		const step = followStep({
			entries: [line('a')],
			newestId: 'a',
			mark: NOT_FOLLOWING,
			pinned: false,
			at: null,
		});

		expect(step.open).toMatchObject({issueId: 'ISSUE_1'});
	});

	// Switching on while already reading the newest thing is not a navigation.
	it('opens nothing on the first look when the reader is already there', () => {
		const step = followStep({
			entries: [line('a', {issue: 'ISSUE_2'})],
			newestId: 'a',
			mark: NOT_FOLLOWING,
			pinned,
			at: {kind: 'ticket', issueId: 'ISSUE_2', tab: 'overview'},
		});

		expect(step.open).toBeNull();
		expect(step.mark).toEqual({line: 'a'});
	});

	it('opens the line that arrives after it', () => {
		const step = followStep({
			entries: [line('a'), line('b', {issue: 'ISSUE_2'})],
			newestId: 'b',
			mark: {line: 'a'},
			pinned,
			at: null,
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
			mark: {line: 'a'},
			pinned,
			at: null,
		});

		expect(step.open).toMatchObject({issueId: 'ISSUE_3'});
	});

	// Scrolled back the reader is reading, and the pane already refuses to pull
	// itself to the foot. Following obeys the same rule rather than a second one.
	it('opens nothing while the reader has scrolled back', () => {
		const step = followStep({
			entries: [line('a'), line('b', {issue: 'ISSUE_2'})],
			newestId: 'b',
			mark: {line: 'a'},
			pinned: false,
			at: null,
		});

		expect(step.open).toBeNull();
		// And the line is not banked, so it is still followed on the way back.
		expect(step.mark).toEqual({line: 'a'});
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
			mark: {line: 'a'},
			pinned,
			at: null,
		});

		expect(step.open).toMatchObject({issueId: 'ISSUE_2'});
	});

	// A burst of nothing-lines must not leave following waiting to be told again.
	it('banks a burst that leads nowhere at all', () => {
		const step = followStep({
			entries: [line('a', {issue: null, action: 'add.board'})],
			newestId: 'a',
			mark: {line: 'z'},
			pinned,
			at: null,
		});

		expect(step.open).toBeNull();
		expect(step.mark.line).toBe('a');
	});

	// The reader is already there; a run of edits on the open ticket would
	// otherwise re-open it on every one.
	it('does not open where the reader already is', () => {
		const step = followStep({
			entries: [line('a'), line('b', {issue: 'ISSUE_2'})],
			newestId: 'b',
			mark: {line: 'a'},
			pinned,
			at: {kind: 'ticket', issueId: 'ISSUE_2', tab: 'overview'},
		});

		expect(step.open).toBeNull();
		expect(step.mark.line).toBe('b');
	});

	// The bug this replaced a `went` mark to fix: following used to remember
	// where *it* had sent the reader, so once they clicked away by hand it went
	// quiet on the very ticket the log was talking about.
	it('opens a ticket it opened before, once the reader has walked off it', () => {
		const step = followStep({
			entries: [line('a', {issue: 'ISSUE_2'})],
			newestId: 'a',
			mark: {line: 'z'},
			pinned,
			at: {kind: 'ticket', issueId: 'ISSUE_9', tab: 'overview'},
		});

		expect(step.open).toMatchObject({issueId: 'ISSUE_2'});
	});

	// A comment opens among the comments, which is a different destination on
	// the same ticket — so it is opened even though the ticket has not changed.
	it('opens the same ticket again when the tab it wants differs', () => {
		const step = followStep({
			entries: [line('a', {issue: 'ISSUE_2', action: 'add.issue.comment'})],
			newestId: 'a',
			mark: {line: 'z'},
			pinned,
			at: {kind: 'ticket', issueId: 'ISSUE_2', tab: 'overview'},
		});

		expect(step.open).toMatchObject({tab: 'comments'});
	});

	it('does not re-open a commit diff the reader is already reading', () => {
		const step = followStep({
			entries: [line('a', {sha: 'abc123', issue: null, action: null})],
			newestId: 'a',
			mark: {line: 'z'},
			pinned,
			at: {kind: 'commit', sha: 'abc123'},
		});

		expect(step.open).toBeNull();
	});

	it('opens a commit line at its diff', () => {
		const step = followStep({
			entries: [line('a', {sha: 'abc123', issue: null, action: null})],
			newestId: 'a',
			mark: {line: 'z'},
			pinned,
			at: null,
		});

		expect(step.open).toEqual({kind: 'commit', sha: 'abc123'});
	});
});

// Finding 2 from the review of this branch: the scan used to run to the start
// of the slice, so a burst that led nowhere fell back to an older line and
// opened a ticket nothing had happened to.
describe('followStep, past the line it has already seen', () => {
	it('opens nothing when everything new leads nowhere', () => {
		const step = followStep({
			entries: [
				line('old', {issue: 'ISSUE_OLD'}),
				line('new', {issue: null, action: 'rename.swimlane'}),
			],
			newestId: 'new',
			mark: {line: 'old'},
			pinned,
			at: null,
		});

		expect(step.open).toBeNull();
		expect(step.mark.line).toBe('new');
	});

	// The same shape as switching on next to an hour-old ticket line: the mark
	// is seeded to it, and the next arrival leads nowhere.
	it('does not fall back past the mark to a line already seen', () => {
		const seeded = followStep({
			entries: [line('a', {issue: 'ISSUE_2'})],
			newestId: 'a',
			mark: NOT_FOLLOWING,
			pinned,
			at: null,
		});

		const next = followStep({
			entries: [
				line('a', {issue: 'ISSUE_2'}),
				line('b', {issue: null, action: 'add.board'}),
			],
			newestId: 'b',
			mark: seeded.mark,
			pinned,
			at: null,
		});

		expect(next.open).toBeNull();
	});
});
