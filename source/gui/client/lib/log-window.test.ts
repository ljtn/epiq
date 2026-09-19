import {describe, expect, it} from 'vitest';
import {parseLogLinesMessage, parseLogWindowMessage} from './log-window';

describe('parseLogWindowMessage', () => {
	it('reads the four things a window can say', () => {
		expect(parseLogWindowMessage({type: 'epiq-log:ready'})).toEqual({
			type: 'epiq-log:ready',
		});
		expect(parseLogWindowMessage({type: 'epiq-log:closed'})).toEqual({
			type: 'epiq-log:closed',
		});
		expect(
			parseLogWindowMessage({
				type: 'epiq-log:open',
				destination: {kind: 'commit', sha: 'abc'},
			}),
		).toEqual({
			type: 'epiq-log:open',
			destination: {kind: 'commit', sha: 'abc'},
			replace: false,
		});
		expect(
			parseLogWindowMessage({
				type: 'epiq-log:open',
				destination: {kind: 'ticket', issueId: 'i1', tab: 'comments'},
			}),
		).toEqual({
			type: 'epiq-log:open',
			destination: {kind: 'ticket', issueId: 'i1', tab: 'comments'},
			replace: false,
		});
	});

	// The channel is shared with every other script that posts to the window,
	// so anything not shaped exactly as one of ours is nothing.
	it('is null for anything else on the channel', () => {
		expect(parseLogWindowMessage(null)).toBeNull();
		expect(parseLogWindowMessage('epiq-log:ready')).toBeNull();
		expect(parseLogWindowMessage({type: 'epiq-log:lines'})).toBeNull();
		expect(parseLogWindowMessage({type: 'epiq-log:open'})).toBeNull();
		expect(
			parseLogWindowMessage({
				type: 'epiq-log:open',
				destination: {kind: 'ticket', issueId: 'i1', tab: 'code'},
			}),
		).toBeNull();
		expect(
			parseLogWindowMessage({
				type: 'epiq-log:open',
				destination: {kind: 'commit'},
			}),
		).toBeNull();
	});
});

describe('parseLogLinesMessage', () => {
	it('reads a slice, moment included', () => {
		expect(
			parseLogLinesMessage({
				type: 'epiq-log:lines',
				entries: [],
				moment: Infinity,
			}),
		).toEqual({
			type: 'epiq-log:lines',
			entries: [],
			moment: Infinity,
			// Absent from an older board, which followed nothing.
			followedLine: null,
			// Likewise: an older board sent every event it had.
			eventsUnlisted: false,
		});
	});

	// 8CYH2TC: the window says the board series was withheld, so the popped-out
	// panel can say so too rather than draw a stretch of commits alone.
	it('carries word of a window too crowded to list', () => {
		expect(
			parseLogLinesMessage({
				type: 'epiq-log:lines',
				entries: [],
				moment: Infinity,
				eventsUnlisted: true,
			})?.eventsUnlisted,
		).toBe(true);
	});

	it('carries the line the board is standing on', () => {
		expect(
			parseLogLinesMessage({
				type: 'epiq-log:lines',
				entries: [],
				moment: 1,
				followedLine: 'event-7',
			}),
		).toMatchObject({followedLine: 'event-7'});
	});

	it('is null for anything else', () => {
		expect(parseLogLinesMessage({type: 'epiq-log:lines'})).toBeNull();
		expect(
			parseLogLinesMessage({type: 'epiq-log:lines', entries: [], moment: '1'}),
		).toBeNull();
		expect(parseLogLinesMessage({type: 'epiq-log:ready'})).toBeNull();
	});
});
