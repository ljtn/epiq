import {describe, expect, it} from 'vitest';
import {answersBoardOnScreen} from './use-board-socket';

describe('answersBoardOnScreen', () => {
	it('takes an answer for the board being looked at', () => {
		expect(answersBoardOnScreen('board-a', 'board-a')).toBe(true);
	});

	// One socket lasts the session, so the reply the reader has outrun arrives
	// all the same. Replacing the socket on every switch is what used to throw
	// it away.
	it('leaves an answer for a board the reader has left', () => {
		expect(answersBoardOnScreen('board-a', 'board-b')).toBe(false);
		expect(answersBoardOnScreen('board-a', null)).toBe(false);
	});

	// The workspace-wide form of a request names no board, and its answer is
	// nobody's to be stale for.
	it('takes an answer that names no board at all', () => {
		expect(answersBoardOnScreen(undefined, 'board-a')).toBe(true);
		expect(answersBoardOnScreen(undefined, null)).toBe(true);
	});
});
