import {describe, expect, it} from 'vitest';
import {GuiTimeTravelStatus} from './gui-state.model';
import {momentOnScreen} from './use-event-log';

const live: GuiTimeTravelStatus = {mode: 'live', asOfTime: null};
const parked: GuiTimeTravelStatus = {mode: 'scrub', asOfTime: 5_000};

describe('momentOnScreen', () => {
	it('stands at the present while the board is live', () => {
		expect(momentOnScreen(false, null, live)).toBe(Infinity);
		expect(momentOnScreen(false, null, undefined)).toBe(Infinity);
	});

	it('follows the needle while the board is parked in the past', () => {
		expect(momentOnScreen(false, null, parked)).toBe(5_000);
	});

	it('follows the playhead while a movie runs', () => {
		expect(momentOnScreen(true, 1_234, live)).toBe(1_234);
	});

	// A movie opens on the board as it was before any of it happened, which is a
	// real position — not the absence of a movie, and not the present.
	it('stands before every event while a movie has yet to reach its first', () => {
		expect(momentOnScreen(true, null, live)).toBe(-Infinity);
	});

	// The playhead outranks a checkout: a movie is itself a run of checkouts, so
	// the board reports `scrub` throughout one.
	it('prefers the playhead to the checkout it is made of', () => {
		expect(momentOnScreen(true, 1_234, parked)).toBe(1_234);
		expect(momentOnScreen(true, null, parked)).toBe(-Infinity);
	});
});
