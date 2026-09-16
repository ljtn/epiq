import {describe, expect, it} from 'vitest';
import {
	createWheelPager,
	isHorizontalWheel,
	WHEEL_GESTURE_QUIET_MS,
	WHEEL_PAGE_THRESHOLD_PX,
} from './paging';

describe('createWheelPager', () => {
	it('turns one page once a swipe has travelled far enough', () => {
		const pager = createWheelPager();
		const step = WHEEL_PAGE_THRESHOLD_PX / 4;

		expect(pager.feed(-step, 0, 0)).toBe(0);
		expect(pager.feed(-step, 0, 10)).toBe(0);
		expect(pager.feed(-step, 0, 20)).toBe(0);
		expect(pager.feed(-step, 0, 30)).toBe(-1);
	});

	it('reads left as earlier and right as later', () => {
		expect(createWheelPager().feed(-WHEEL_PAGE_THRESHOLD_PX, 0, 0)).toBe(-1);
		expect(createWheelPager().feed(WHEEL_PAGE_THRESHOLD_PX, 0, 0)).toBe(1);
	});

	// A swipe is dozens of events, and the ones after the page turned would
	// otherwise turn several more.
	it('turns no second page in the same gesture', () => {
		const pager = createWheelPager();

		expect(pager.feed(WHEEL_PAGE_THRESHOLD_PX, 0, 0)).toBe(1);
		expect(pager.feed(WHEEL_PAGE_THRESHOLD_PX * 5, 0, 10)).toBe(0);
		expect(pager.feed(WHEEL_PAGE_THRESHOLD_PX * 5, 0, 20)).toBe(0);
	});

	it('starts a new gesture once the wheel has been quiet', () => {
		const pager = createWheelPager();

		expect(pager.feed(WHEEL_PAGE_THRESHOLD_PX, 0, 0)).toBe(1);
		expect(
			pager.feed(WHEEL_PAGE_THRESHOLD_PX, 0, WHEEL_GESTURE_QUIET_MS + 1),
		).toBe(1);
	});

	// Half a threshold, a pause, half a threshold: two nudges, not one push.
	it('does not add up nudges across a quiet spell', () => {
		const pager = createWheelPager();
		const half = WHEEL_PAGE_THRESHOLD_PX / 2;

		expect(pager.feed(half, 0, 0)).toBe(0);
		expect(pager.feed(half, 0, WHEEL_GESTURE_QUIET_MS + 1)).toBe(0);
	});

	it('leaves a mostly vertical scroll alone', () => {
		const pager = createWheelPager();

		expect(
			pager.feed(WHEEL_PAGE_THRESHOLD_PX, WHEEL_PAGE_THRESHOLD_PX, 0),
		).toBe(0);
		expect(pager.feed(10, 200, 10)).toBe(0);
	});
});

describe('isHorizontalWheel', () => {
	it('is the wheel going more sideways than down', () => {
		expect(isHorizontalWheel(-30, 4)).toBe(true);
		expect(isHorizontalWheel(3, -40)).toBe(false);
		expect(isHorizontalWheel(0, 0)).toBe(false);
	});
});
