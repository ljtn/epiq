import {describe, expect, it} from 'vitest';
import {seededRandom} from './helpers/seeded-random.js';
import {ulid} from 'ulid';
import {AppEvent, EventAction} from '../lib/board/board-events.model.js';
import {
	enteredLaneAt,
	foldHistory,
	visitsOf,
} from '../lib/board/node-history.js';

// The lane rules, read from a history folded from `log`.
const laneEntryTime = (log: AppEvent[], createdAt: number) =>
	enteredLaneAt(foldHistory(undefined, 'i1', log), createdAt);
const laneVisits = (log: AppEvent[], createdAt: number) =>
	visitsOf(foldHistory(undefined, 'i1', log), createdAt);

const HOUR_MS = 60 * 60 * 1000;

const at = (
	time: number,
	action: EventAction,
	payload: Record<string, unknown>,
): AppEvent =>
	({
		id: ulid(time),
		userId: 'user-1',
		action,
		payload,
	} as AppEvent);

describe('laneEntryTime', () => {
	const created = Date.now() - 100 * HOUR_MS;

	it('falls back to createdAt for a log that never names a parent', () => {
		const log = [at(created + HOUR_MS, 'edit.title', {id: 'i1', name: 'Hi'})];

		expect(laneEntryTime(log, created)).toBe(created);
	});

	it('takes the time of the move that put it in its current lane', () => {
		const moved = created + 40 * HOUR_MS;

		const log = [
			at(created, 'add.issue', {id: 'i1', parent: 'backlog', rank: 'a'}),
			at(moved, 'move.node', {id: 'i1', parent: 'review', rank: 'a'}),
		];

		expect(laneEntryTime(log, created)).toBe(moved);
	});

	it('ignores a move that only reorders the ticket within its own lane', () => {
		const arrived = created + 10 * HOUR_MS;

		const log = [
			at(created, 'add.issue', {id: 'i1', parent: 'backlog', rank: 'a'}),
			at(arrived, 'move.node', {id: 'i1', parent: 'review', rank: 'a'}),
			at(created + 90 * HOUR_MS, 'move.node', {
				id: 'i1',
				parent: 'review',
				rank: 'b',
			}),
		];

		expect(laneEntryTime(log, created)).toBe(arrived);
	});

	it('counts a reopen as arriving in the lane it is reopened into', () => {
		const reopened = created + 80 * HOUR_MS;

		const log = [
			at(created, 'add.issue', {id: 'i1', parent: 'backlog', rank: 'a'}),
			at(created + 20 * HOUR_MS, 'close.issue', {
				id: 'i1',
				parent: 'closed',
				rank: 'a',
			}),
			at(reopened, 'reopen.issue', {id: 'i1', parent: 'backlog', rank: 'a'}),
		];

		expect(laneEntryTime(log, created)).toBe(reopened);
	});

	it('reads a ticket created in a lane and never moved as arriving then', () => {
		const log = [
			at(created, 'add.issue', {id: 'i1', parent: 'backlog', rank: 'a'}),
		];

		expect(laneEntryTime(log, created)).toBe(created);
	});

	it('clamps a move stamped by a wildly fast clock to now', () => {
		const now = Date.now();

		const log = [
			at(created, 'add.issue', {id: 'i1', parent: 'backlog', rank: 'a'}),
			at(now + 100 * 365 * 24 * HOUR_MS, 'move.node', {
				id: 'i1',
				parent: 'review',
				rank: 'a',
			}),
		];

		expect(laneEntryTime(log, created)).toBeLessThanOrEqual(Date.now());
	});
});

describe('laneEntryTime against laneVisits', () => {
	it('is the last visit, over moves, reorders, closes and undecodable ids', () => {
		const created = Date.now() - 1000 * HOUR_MS;
		const random = seededRandom(7);
		const actions: EventAction[] = [
			'move.node',
			'close.issue',
			'reopen.issue',
			'edit.title',
			'add.issue.tag',
		];

		for (let run = 0; run < 500; run++) {
			const log = Array.from({length: random(12)}, (_, index) => {
				const event = at(
					created + index * HOUR_MS,
					actions[random(actions.length)]!,
					{id: 'i1', parent: ['a', 'b', 'closed'][random(3)], rank: 'a'},
				);
				return random(15) === 0 ? {...event, id: 'not-a-ulid'} : event;
			});

			expect(laneEntryTime(log, created)).toBe(
				laneVisits(log, created).at(-1)?.enteredAt ?? created,
			);
		}
	});
});
