import {describe, expect, it} from 'vitest';
import {scrollEndsHover} from './hover-card';

// Stands in for a scrollable box, answering only the question the rule asks.
const box = (holdsTrigger: boolean) => ({contains: () => holdsTrigger});

const trigger = {};

describe('scrollEndsHover', () => {
	it('ends the hover when the box scrolled holds the trigger', () => {
		expect(scrollEndsHover(box(true), trigger)).toBe(true);
	});

	// The regression this exists for: a swimlane eases a card into view for
	// about a second, which outlasts the hover delay. Dismissing on that
	// scroll meant no hint could open on a board big enough to scroll.
	it('leaves it alone when some other box scrolled', () => {
		expect(scrollEndsHover(box(false), trigger)).toBe(false);
	});

	it('has nothing to end when no hover is in flight', () => {
		expect(scrollEndsHover(box(true), null)).toBe(false);
	});

	it('ends it when the thing scrolled cannot say what it holds', () => {
		expect(scrollEndsHover(null, trigger)).toBe(true);
		expect(scrollEndsHover({}, trigger)).toBe(true);
	});
});
