import {describe, expect, it} from 'vitest';
import {bodyRefs, inCommitWindow} from '../lib/commits/commit-timeline.js';

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

describe('bodyRefs', () => {
	it('reads a trailer, in any case', () => {
		expect(bodyRefs('Pin the tag.\n\nepiq-ref: b8pytcm\n')).toEqual([
			'B8PYTCM',
		]);
	});

	// A squash commit's body is the squashed messages run together, so each
	// one's trailer sits mid-body, not in the final paragraph git would parse.
	it('finds every trailer in a squash body, once each', () => {
		const body = [
			'* B8PYTCM pin the tag',
			'',
			'Epiq-Ref: B8PYTCM',
			'',
			'* tidy the changelog',
			'',
			'  Epiq-Ref: W1TCS14',
			'Epiq-Ref: B8PYTCM',
			'',
			'Co-authored-by: Someone <someone@example.com>',
		].join('\n');

		expect(bodyRefs(body)).toEqual(['B8PYTCM', 'W1TCS14']);
	});

	it('reads several refs listed on one line', () => {
		expect(bodyRefs('Epiq-Ref: B8PYTCM, w1tcs14 VW1Z3QE')).toEqual([
			'B8PYTCM',
			'W1TCS14',
			'VW1Z3QE',
		]);
	});

	it('keeps the refs on a line that also holds something else', () => {
		expect(bodyRefs('Epiq-Ref: B8PYTCM, refused by review')).toEqual([
			'B8PYTCM',
		]);
	});

	it('ignores a mention that is not a line of its own, or not a ref', () => {
		expect(bodyRefs('Carried over from Epiq-Ref: B8PYTCM last week.')).toEqual(
			[],
		);
		expect(bodyRefs('Epiq-Ref: B8PYTC')).toEqual([]);
		expect(bodyRefs('Epiq-Ref: B8PYTCMX')).toEqual([]);
	});
});
