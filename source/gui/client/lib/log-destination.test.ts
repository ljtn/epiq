import {describe, expect, it} from 'vitest';
import {LogEntry} from './event-log';
import {
	destinationFromAttributes,
	destinationOf,
	rowAttributes,
} from './log-destination';

const entry = (over: Partial<LogEntry>): LogEntry => ({
	id: 'e1',
	t: 1,
	label: 'a line',
	color: '#111',
	actor: null,
	diff: null,
	issue: null,
	target: null,
	action: null,
	sha: null,
	...over,
});

describe('destinationOf', () => {
	it('sends a commit to its own diff', () => {
		expect(destinationOf(entry({sha: 'abc123'}))).toEqual({
			kind: 'commit',
			sha: 'abc123',
		});
	});

	it('sends a comment to the tab it was written on', () => {
		expect(
			destinationOf(entry({issue: 'i1', action: 'add.issue.comment'})),
		).toEqual({kind: 'ticket', issueId: 'i1', tab: 'comments'});
	});

	// Editing and deleting a comment are read there too — the whole category
	// goes to one place rather than each action being listed twice.
	it('sends every kind of comment event to the comments', () => {
		for (const action of ['edit.issue.comment', 'delete.issue.comment']) {
			expect(destinationOf(entry({issue: 'i1', action}))).toEqual({
				kind: 'ticket',
				issueId: 'i1',
				tab: 'comments',
			});
		}
	});

	// WKK7PS0: the tab was as far as a comment line went, and the reader still
	// had to find the comment among however many the ticket holds.
	it('sends a comment line to the comment itself, where it knows which', () => {
		expect(
			destinationOf(
				entry({issue: 'i1', action: 'add.issue.comment', target: 'c1'}),
			),
		).toEqual({kind: 'ticket', issueId: 'i1', tab: 'comments', comment: 'c1'});
	});

	// A board that predates the target reaching the wire sends a comment line
	// with nothing on it, and the tab is still the right answer.
	it('sends a comment line with no comment on it to the tab, as before', () => {
		expect(
			destinationOf(entry({issue: 'i1', action: 'add.issue.comment'})),
		).toEqual({kind: 'ticket', issueId: 'i1', tab: 'comments'});
	});

	it('sends everything else about a ticket to its overview', () => {
		for (const action of [
			'edit.description',
			'edit.title',
			'add.issue.tag',
			'add.issue.assignee',
			'move.node',
		]) {
			expect(destinationOf(entry({issue: 'i1', action}))).toEqual({
				kind: 'ticket',
				issueId: 'i1',
				tab: 'overview',
			});
		}
	});

	// A board or swimlane event happened to no ticket, so a click on it has
	// nowhere to go — and the row must not pretend otherwise.
	it('leads nowhere from an event with no ticket', () => {
		expect(destinationOf(entry({action: 'add.swimlane'}))).toBeNull();
		expect(rowAttributes(entry({action: 'add.swimlane'}))).toBeUndefined();
	});
});

// The row carries the answer and the click reads it back; nothing else knows
// the attribute names, so the pair is only correct together. Reading is over a
// bare lookup, which is what a DOM element is to this — the `closest` call that
// finds the row is covered by the browser test.
describe('rowAttributes and destinationFromAttributes', () => {
	const roundTrip = (source: LogEntry) => {
		const attributes = new Map(Object.entries(rowAttributes(source) ?? {}));

		return destinationFromAttributes(name => attributes.get(name) ?? null);
	};

	it('carries a commit through the attributes and back', () => {
		const source = entry({sha: 'abc123'});

		expect(roundTrip(source)).toEqual(destinationOf(source));
	});

	it('carries a ticket and its tab through the attributes and back', () => {
		for (const action of ['add.issue.comment', 'edit.description']) {
			const source = entry({issue: 'i1', action});

			expect(roundTrip(source)).toEqual(destinationOf(source));
		}
	});

	it('carries the comment a line points at through and back', () => {
		const source = entry({
			issue: 'i1',
			action: 'add.issue.comment',
			target: 'c1',
		});

		expect(roundTrip(source)).toEqual(destinationOf(source));
		expect(roundTrip(source)).toMatchObject({comment: 'c1'});
	});

	it('is null for a row carrying nothing', () => {
		expect(destinationFromAttributes(() => null)).toBeNull();
	});
});
