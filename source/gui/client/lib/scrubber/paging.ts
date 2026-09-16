// Paging the window from the chart itself: a horizontal wheel or a trackpad
// swipe across it is a page earlier or later, once per gesture.
//
// A gesture is a burst of wheel events, dozens of them for one swipe, each
// carrying a slice of the distance. Paging fetches a new window from the
// server, so one swipe must be one page: the slices are summed until they
// amount to a deliberate push, that page is turned, and the rest of the burst
// is ignored until it has been quiet long enough to count as a new one.

export type PageDirection = -1 | 0 | 1;

// How far a swipe has to travel before it turns a page. A flick on a trackpad
// is a few hundred pixels; a scroll wheel's horizontal tilt is far coarser and
// crosses this in a click or two.
export const WHEEL_PAGE_THRESHOLD_PX = 120;

// How long the wheel has to fall quiet before the next event starts a new
// gesture rather than continuing the last one.
export const WHEEL_GESTURE_QUIET_MS = 400;

export type WheelPager = {
	// Feeds one wheel event and says whether it turned a page: -1 for earlier,
	// 1 for later, 0 for not yet or not this gesture.
	feed: (deltaX: number, deltaY: number, now: number) => PageDirection;
};

export const createWheelPager = (): WheelPager => {
	let travelled = 0;
	let lastAt = -Infinity;
	let turned = false;

	return {
		feed: (deltaX, deltaY, now) => {
			if (now - lastAt > WHEEL_GESTURE_QUIET_MS) {
				travelled = 0;
				turned = false;
			}
			lastAt = now;

			// Mostly vertical is the page scrolling, not the chart paging.
			if (Math.abs(deltaX) <= Math.abs(deltaY) || turned) return 0;

			travelled += deltaX;

			if (Math.abs(travelled) < WHEEL_PAGE_THRESHOLD_PX) return 0;

			turned = true;

			// Scrolling left brings what is to the left into view: earlier.
			return travelled < 0 ? -1 : 1;
		},
	};
};

// Whether a wheel event is the chart's to take: horizontal enough that letting
// it through would swipe the browser's history instead.
export const isHorizontalWheel = (deltaX: number, deltaY: number): boolean =>
	Math.abs(deltaX) > Math.abs(deltaY);
