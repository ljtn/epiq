import {describe, expect, it} from 'vitest';
import {ulid} from 'ulid';
import {AppEvent, EventAction} from '../lib/event/event.model.js';
import {laneEntryTime} from '../lib/utils/lane-dwell.js';

const HOUR_MS = 60 * 60 * 1000;

const at = (
	time: number,
	action: EventAction,
	payload: Record<string, unknown>,
): AppEvent =>
	({
		id: ulid(time),
		userId: 'user-1',
		userName: 'someone',
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
