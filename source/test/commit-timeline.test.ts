import {describe, expect, it} from 'vitest';
import {inCommitWindow} from '../lib/commits/commit-timeline.js';

// 2026-09-20T00:00:07.000Z, and the window that opens 640ms into that second.
const SECOND = Date.UTC(2026, 8, 20, 0, 0, 7);
const MID_SECOND = SECOND + 640;

describe('inCommitWindow', () => {
	// A commit time carries seconds, so one made anywhere in the second a window
	// opens reads as that second's start. Compared strictly it falls just
	// outside — and for a ticket's window, opened at the moment the ticket was
	// created, that is the ticket's own first commit.
	it('keeps a commit made in the second the window opens', () => {
		expect(inCommitWindow(SECOND, MID_SECOND, undefined)).toBe(true);
	});

	it('drops a commit from the second before that', () => {
		expect(inCommitWindow(SECOND - 1000, MID_SECOND, undefined)).toBe(false);
	});

	it('drops a commit past the end, and keeps one on it', () => {
		expect(inCommitWindow(SECOND + 1000, undefined, SECOND)).toBe(false);
		expect(inCommitWindow(SECOND, undefined, SECOND)).toBe(true);
	});

	it('keeps everything with no window', () => {
		expect(inCommitWindow(SECOND, undefined, undefined)).toBe(true);
	});
});
