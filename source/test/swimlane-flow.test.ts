import {describe, expect, it} from 'vitest';
import {deriveLaneFlow} from '../lib/stats/swimlane-flow.js';

const titles: Record<string, string> = {
	backlog: 'Backlog',
	ongoing: 'Ongoing',
	review: 'Review',
	done: 'Done',
	closed: 'Closed',
};

const titleOf = (laneId: string) => titles[laneId] ?? 'Elsewhere';

const flow = (journeys: string[][]) =>
	deriveLaneFlow('review', journeys, titleOf);

describe('deriveLaneFlow', () => {
	it('says nothing about a lane nothing has been through', () => {
		const result = flow([['backlog', 'ongoing', 'done']]);

		expect(result.arrived).toBe(0);
		expect(result.departed).toBe(0);
		expect(result.arrivesFrom).toEqual([]);
		expect(result.movesOnTo).toEqual([]);
	});

	it('names the lane a ticket came from and the one it went to', () => {
		const result = flow([['backlog', 'ongoing', 'review', 'done']]);

		expect(result.arrivesFrom).toEqual([
			{laneId: 'ongoing', title: 'Ongoing', count: 1, share: 1},
		]);
		expect(result.movesOnTo).toEqual([
			{laneId: 'done', title: 'Done', count: 1, share: 1},
		]);
	});

	// A ticket filed straight into the lane came from nowhere, which is a
	// different fact from having come from a lane.
	it('counts a ticket filed into the lane as arriving from nowhere', () => {
		const result = flow([['review', 'done']]);

		expect(result.arrivesFrom).toEqual([
			{laneId: null, title: 'Filed here', count: 1, share: 1},
		]);
	});

	// The whole reason the panel ranks rather than naming a winner.
	it('splits the sources by share rather than naming one', () => {
		const result = flow([
			['ongoing', 'review', 'done'],
			['ongoing', 'review', 'done'],
			['ongoing', 'review', 'done'],
			['backlog', 'review', 'done'],
		]);

		expect(result.arrived).toBe(4);
		expect(result.arrivesFrom.map(entry => [entry.title, entry.count])).toEqual(
			[
				['Ongoing', 3],
				['Backlog', 1],
			],
		);
		expect(result.arrivesFrom[0]!.share).toBe(0.75);
	});

	// Counting them as departures would read as a lane nothing ever leaves.
	it('leaves tickets still sitting in the lane out of the departures', () => {
		const result = flow([
			['ongoing', 'review', 'done'],
			['ongoing', 'review'],
			['ongoing', 'review'],
		]);

		expect(result.arrived).toBe(3);
		expect(result.departed).toBe(1);
		expect(result.movesOnTo).toEqual([
			{laneId: 'done', title: 'Done', count: 1, share: 1},
		]);
	});

	// A lane work comes back to looks nothing like one it goes through once,
	// and that only shows if both passes count.
	it('counts every pass a ticket makes through the lane', () => {
		const result = flow([['ongoing', 'review', 'ongoing', 'review', 'done']]);

		expect(result.arrived).toBe(2);
		expect(result.departed).toBe(2);
		expect(result.movesOnTo.map(entry => [entry.title, entry.count])).toEqual([
			['Done', 1],
			['Ongoing', 1],
		]);
	});

	it('reads a ticket closed out of the lane as going to the closed lane', () => {
		const result = flow([['review', 'closed']]);

		expect(result.movesOnTo).toEqual([
			{laneId: 'closed', title: 'Closed', count: 1, share: 1},
		]);
	});

	it('names a lane the board no longer has rather than dropping it', () => {
		const result = flow([['deleted-lane', 'review']]);

		expect(result.arrivesFrom).toEqual([
			{laneId: 'deleted-lane', title: 'Elsewhere', count: 1, share: 1},
		]);
	});
});
