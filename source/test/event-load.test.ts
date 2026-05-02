import {describe, expect, it} from 'vitest';
import {getSortedEvents, ReconstructedEvent} from '../lib/event/event-load.js';

describe('getSortedEvents', () => {
	const event = (
		id: string,
		afterRef: string | null,
		action = 'test.event',
	): ReconstructedEvent =>
		({
			id: afterRef ? [id, afterRef] : [id],
			[action]: {},
			userId: 'user',
			userName: 'User',
			v: 1,
		} as unknown as ReconstructedEvent);

	it('places an event after its insertion anchor even when input order is reversed', () => {
		const addIssue = event(
			'01KQN37Z9877YBRV6P2YG7Q62S',
			'01KQMFD60TR62NRKX8B32KNKWH',
		);
		const editTitle = event(
			'01KQN3C8WNF8Q8WXQYPF54S4MC',
			'01KQN37Z9877YBRV6P2YG7Q62S',
		);

		const sorted = getSortedEvents([
			editTitle,
			addIssue,
			event('01KQMFD60TR62NRKX8B32KNKWH', null),
		]);

		expect(sorted.map(e => e.id[0])).toEqual([
			'01KQMFD60TR62NRKX8B32KNKWH',
			'01KQN37Z9877YBRV6P2YG7Q62S',
			'01KQN3C8WNF8Q8WXQYPF54S4MC',
		]);
	});

	it('sorts multiple events with the same insertion anchor by ULID', () => {
		const root = event('01A', null);
		const c = event('01D', '01A');
		const a = event('01B', '01A');
		const b = event('01C', '01A');

		const sorted = getSortedEvents([c, root, b, a]);

		expect(sorted.map(e => e.id[0])).toEqual(['01A', '01B', '01C', '01D']);
	});

	it('places anchored events immediately after their anchor, before later siblings', () => {
		const root = event('01A', null);
		const firstSibling = event('01B', '01A');
		const secondSibling = event('01C', '01A');
		const anchoredToFirstSibling = event('01D', '01B');

		const sorted = getSortedEvents([
			anchoredToFirstSibling,
			secondSibling,
			firstSibling,
			root,
		]);

		expect(sorted.map(e => e.id[0])).toEqual(['01A', '01B', '01D', '01C']);
	});

	it('does not reverse siblings when inserting multiple anchored events', () => {
		const root = event('01A', null);
		const first = event('01B', '01A');
		const second = event('01C', '01A');
		const third = event('01D', '01A');

		const sorted = getSortedEvents([third, second, first, root]);

		expect(sorted.map(e => e.id[0])).toEqual(['01A', '01B', '01C', '01D']);
	});

	it('appends dangling events deterministically by ULID', () => {
		const root = event('01A', null);
		const danglingB = event('01B', 'missing-ref');
		const danglingC = event('01C', 'also-missing');

		const sorted = getSortedEvents([danglingC, root, danglingB]);

		expect(sorted.map(e => e.id[0])).toEqual(['01A', '01B', '01C']);
	});
});
