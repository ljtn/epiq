import {describe, expect, it} from 'vitest';
import {parseLogLinesMessage, parseLogWindowMessage} from './log-window';

describe('parseLogWindowMessage', () => {
	it('reads the three things a window can say', () => {
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
		});
		expect(
			parseLogWindowMessage({
				type: 'epiq-log:open',
				destination: {kind: 'ticket', issueId: 'i1', tab: 'comments'},
			}),
		).toEqual({
			type: 'epiq-log:open',
			destination: {kind: 'ticket', issueId: 'i1', tab: 'comments'},
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
		).toEqual({type: 'epiq-log:lines', entries: [], moment: Infinity});
	});

	it('is null for anything else', () => {
		expect(parseLogLinesMessage({type: 'epiq-log:lines'})).toBeNull();
		expect(
			parseLogLinesMessage({type: 'epiq-log:lines', entries: [], moment: '1'}),
		).toBeNull();
		expect(parseLogLinesMessage({type: 'epiq-log:ready'})).toBeNull();
	});
});
