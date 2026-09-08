import {describe, expect, it} from 'vitest';
import {
	deriveLaneStayTrend,
	deriveLaneStayTrends,
} from '../lib/stats/lane-trend.js';
import {LaneVisit} from '../lib/utils/lane-dwell.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

const trend = (journeys: LaneVisit[][], days = 5) =>
	deriveLaneStayTrend({laneId: 'review', journeys, now: NOW, days});

const visit = (laneId: string, daysAgo: number): LaneVisit => ({
	laneId,
	enteredAt: NOW - daysAgo * DAY,
});

describe('deriveLaneStayTrend', () => {
	it('gives one point per day, oldest first, ending now', () => {
		const points = trend([], 5);

		expect(points).toHaveLength(5);
		expect(points.at(-1)!.t).toBe(NOW);
		expect(points[0]!.t).toBe(NOW - 4 * DAY);
	});

	// Not zero: nothing waiting is a different statement from everything being
	// served instantly, and a line through zero would make the second.
	it('leaves a day the lane stood empty unmeasured', () => {
		const points = trend([[visit('review', 1)]], 3);

		expect(points[0]!.median).toBeNull();
		expect(points[0]!.count).toBe(0);
		expect(points.at(-1)!.median).toBe(DAY);
	});

	it('ages a ticket that has sat still, one day per day', () => {
		const points = trend([[visit('review', 4)]], 5);

		expect(points.map(point => point.median)).toEqual([
			0,
			DAY,
			2 * DAY,
			3 * DAY,
			4 * DAY,
		]);
	});

	// The reading is reconstructed, so a ticket that left weeks ago still counts
	// on the days it was there and stops counting the day it left.
	it('counts a ticket only while it was actually in the lane', () => {
		const points = trend([[visit('review', 4), visit('done', 2)]], 5);

		expect(points.map(point => point.count)).toEqual([1, 1, 0, 0, 0]);
		expect(points[1]!.median).toBe(DAY);
		expect(points[2]!.median).toBeNull();
	});

	it('takes the median across everything standing there that day', () => {
		const points = trend(
			[[visit('review', 4)], [visit('review', 2)], [visit('review', 0)]],
			5,
		);

		// Day 4 back: only the first, at nothing. Today: 4d, 2d and 0d.
		expect(points[0]!.median).toBe(0);
		expect(points.at(-1)!.count).toBe(3);
		expect(points.at(-1)!.median).toBe(2 * DAY);
	});

	it('reads a ticket that came back as being here on both visits', () => {
		const points = trend(
			[[visit('review', 4), visit('ongoing', 3), visit('review', 1)]],
			5,
		);

		expect(points.map(point => point.count)).toEqual([1, 0, 0, 1, 1]);
		// Its second stay is measured from the day it came back, not the first.
		expect(points.at(-1)!.median).toBe(DAY);
	});

	it('ignores tickets that have never been in the lane', () => {
		const points = trend([[visit('todo', 3), visit('done', 1)]], 4);

		expect(points.every(point => point.median === null)).toBe(true);
	});
});

describe('deriveLaneStayTrends', () => {
	// The header draws every lane at once, so one pass fills them all — and each
	// lane has to come back with only its own tickets in it.
	it('keeps each lane to its own tickets in one pass', () => {
		const trends = deriveLaneStayTrends({
			laneIds: ['review', 'done'],
			journeys: [[visit('review', 4), visit('done', 2)], [visit('review', 1)]],
			now: NOW,
			days: 5,
		});

		expect(trends['review']!.map(point => point.count)).toEqual([
			1, 1, 0, 1, 1,
		]);
		expect(trends['done']!.map(point => point.count)).toEqual([0, 0, 1, 1, 1]);
	});

	it('gives an untouched lane a full series of empty days', () => {
		const trends = deriveLaneStayTrends({
			laneIds: ['review', 'icebox'],
			journeys: [[visit('review', 1)]],
			now: NOW,
			days: 3,
		});

		expect(trends['icebox']).toHaveLength(3);
		expect(trends['icebox']!.every(point => point.median === null)).toBe(true);
	});
});
