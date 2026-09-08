import {describe, expect, it} from 'vitest';
import {GuiIssue} from './gui-state.model';
import {dwellLevel, dwellOf, laneDwell} from './lane-dwell';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const NOW = 1_700_000_000_000;

const ticket = (hoursInLane: number, overrides: Partial<GuiIssue> = {}) =>
	({
		id: `i${hoursInLane}`,
		ref: 'ABC1234',
		title: 'A ticket',
		description: '',
		createdAt: NOW - hoursInLane * HOUR,
		enteredLaneAt: NOW - hoursInLane * HOUR,
		readonly: false,
		isClosed: false,
		tags: [],
		assignees: [],
		...overrides,
	} satisfies GuiIssue);

describe('dwellOf', () => {
	it('reads a ticket entered in the future as having just arrived', () => {
		expect(dwellOf(ticket(-3), NOW)).toBe(0);
	});
});

describe('laneDwell', () => {
	it('is null for a lane with nothing open in it', () => {
		expect(laneDwell([], NOW)).toBeNull();
		expect(laneDwell([ticket(4, {isClosed: true})], NOW)).toBeNull();
	});

	it('leaves closed tickets out of the figures', () => {
		const lane = laneDwell(
			[ticket(2), ticket(4), ticket(500, {isClosed: true})],
			NOW,
		);

		expect(lane?.max).toBe(4 * HOUR);
	});

	it('takes the middle of an odd number of tickets', () => {
		expect(laneDwell([ticket(1), ticket(9), ticket(2)], NOW)?.median).toBe(
			2 * HOUR,
		);
	});

	it('averages the middle pair of an even number of tickets', () => {
		expect(
			laneDwell([ticket(1), ticket(3), ticket(5), ticket(9)], NOW)?.median,
		).toBe(4 * HOUR);
	});

	it('reports a median one stuck ticket cannot drag, and a max that shows it', () => {
		const lane = laneDwell([ticket(1), ticket(2), ticket(3), ticket(720)], NOW);

		expect(lane?.median).toBe(2.5 * HOUR);
		expect(lane?.max).toBe(720 * HOUR);
		expect(lane?.mean).toBeGreaterThan(180 * HOUR);
	});
});

describe('dwellLevel', () => {
	const lane = (hours: number[]) =>
		laneDwell(
			hours.map(h => ticket(h)),
			NOW,
		)!;

	it('says nothing about a lane too small to have a baseline', () => {
		const small = lane([1, 400]);

		expect(dwellLevel(400 * HOUR, small, 2)).toBe('none');
	});

	it('leaves a ticket in line with its lane alone', () => {
		const busy = lane([10, 12, 14]);

		expect(dwellLevel(14 * HOUR, busy, 3)).toBe('none');
	});

	it('warns on a ticket several times its lane median', () => {
		const busy = lane([2, 4, 6, 40]);

		expect(dwellLevel(40 * HOUR, busy, 4)).toBe('warn');
	});

	it('alerts on one far past that', () => {
		const busy = lane([2, 4, 6, 400]);

		expect(dwellLevel(400 * HOUR, busy, 4)).toBe('alert');
	});

	it('holds its tongue in a fast lane, where a multiple is still a short wait', () => {
		const fast = lane([0.1, 0.2, 0.3, 2]);

		// Twenty times the median, and still only two hours old.
		expect(dwellLevel(2 * HOUR, fast, 4)).toBe('none');
	});

	it('warns past a day even where the floor is what carries it', () => {
		const fast = lane([0.1, 0.2, 0.3, 30]);

		expect(dwellLevel(30 * HOUR, fast, 4)).toBe('warn');
		expect(dwellLevel(4 * DAY, fast, 4)).toBe('alert');
	});

	it('stays quiet in a slow lane where everything is old', () => {
		const slow = lane([20 * 24, 22 * 24, 24 * 24]);

		// Well past both floors, but no further out of line than its neighbours.
		expect(dwellLevel(24 * 24 * HOUR, slow, 3)).toBe('none');
	});
});
