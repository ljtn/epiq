// A horizontal wheel or swipe on the chart turns one page per gesture: deltas
// sum to a threshold, then the rest of the burst is ignored until it goes quiet.

export type PageDirection = -1 | 0 | 1;

// How far a swipe travels before it turns a page.
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
