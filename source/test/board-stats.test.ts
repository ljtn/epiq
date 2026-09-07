import {describe, expect, it} from 'vitest';
import {deriveBoardStats} from '../lib/stats/board-stats.js';

const DAY = 86_400_000;
const NOW = 10 * DAY;

const lanes = [
	{id: 'backlog', title: 'Backlog'},
	{id: 'ongoing', title: 'Ongoing'},
	{id: 'review', title: 'Review'},
	{id: 'done', title: 'Done'},
];

const moved = (t: number, parentId: string) => ({
	t,
	action: 'move.node',
	parentId,
});

describe('deriveBoardStats', () => {
	it('ages a ticket from when it was filed', () => {
		const stats = deriveBoardStats({
			createdAt: NOW - 3 * DAY,
			now: NOW,
			history: [],
			lanes,
			currentLaneId: 'backlog',
		});

		expect(stats.ageMs).toBe(3 * DAY);
		expect(stats.laneTitle).toBe('Backlog');
	});

	// A ticket that has never moved has been in its lane for as long as it has
	// existed — not for no time at all.
	it('measures time in lane from filing when nothing has moved', () => {
		const stats = deriveBoardStats({
			createdAt: NOW - 3 * DAY,
			now: NOW,
			history: [],
			lanes,
			currentLaneId: 'backlog',
		});

		expect(stats.inLaneMs).toBe(3 * DAY);
	});

	it('measures time in lane from the move that put it there', () => {
		const stats = deriveBoardStats({
			createdAt: NOW - 8 * DAY,
			now: NOW,
			history: [
				moved(NOW - 6 * DAY, 'ongoing'),
				moved(NOW - 2 * DAY, 'review'),
			],
			lanes,
			currentLaneId: 'review',
		});

		expect(stats.inLaneMs).toBe(2 * DAY);
		expect(stats.laneTitle).toBe('Review');
	});

	it('counts a move to an earlier lane, and only that', () => {
		const stats = deriveBoardStats({
			createdAt: NOW - 8 * DAY,
			now: NOW,
			history: [
				moved(NOW - 7 * DAY, 'ongoing'),
				moved(NOW - 6 * DAY, 'review'),
				// Back to Ongoing: rework.
				moved(NOW - 5 * DAY, 'ongoing'),
				moved(NOW - 4 * DAY, 'review'),
				// And again.
				moved(NOW - 3 * DAY, 'backlog'),
			],
			lanes,
			currentLaneId: 'backlog',
		});

		expect(stats.timesSentBack).toBe(2);
	});

	it('does not count going forwards, however far', () => {
		const stats = deriveBoardStats({
			createdAt: NOW - 2 * DAY,
			now: NOW,
			history: [moved(NOW - DAY, 'done')],
			lanes,
			currentLaneId: 'done',
		});

		expect(stats.timesSentBack).toBe(0);
	});

	// Closing a ticket moves it to a lane on another board entirely. That is
	// leaving, not going backwards.
	it('ignores a move to a lane this board does not have', () => {
		const stats = deriveBoardStats({
			createdAt: NOW - 4 * DAY,
			now: NOW,
			history: [
				moved(NOW - 3 * DAY, 'review'),
				moved(NOW - DAY, 'closed-lane'),
			],
			lanes,
			currentLaneId: 'review',
		});

		expect(stats.timesSentBack).toBe(0);
	});

	it('ignores every event that is not a move', () => {
		const stats = deriveBoardStats({
			createdAt: NOW - 4 * DAY,
			now: NOW,
			history: [
				{t: NOW - 3 * DAY, action: 'add.comment'},
				{t: NOW - 2 * DAY, action: 'edit.title'},
			],
			lanes,
			currentLaneId: 'backlog',
		});

		expect(stats.timesSentBack).toBe(0);
		expect(stats.inLaneMs).toBe(4 * DAY);
	});
});
