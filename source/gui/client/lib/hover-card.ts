// What every floating thing the pointer summons shares: delay, placement and
// dismissal, for both the tooltip and the ticket-ref card.

// Quick enough to feel part of the app, slow enough to skip a passing pointer.
export const HOVER_DELAY_MS = 500;

// Clear of the trigger, close enough to read as belonging to it.
const GAP = 8;

// Kept off the window's own edges when a trigger sits near one.
const MARGIN = 6;

export type Placement = {left: number; top: number};

export const placeHoverCard = (trigger: DOMRect, card: DOMRect): Placement => {
	// Above by default, below only when there is no room, so it does not change
	// sides as the pointer travels along a row of controls.
	const above = trigger.top - card.height - GAP >= MARGIN;
	const top = above ? trigger.top - card.height - GAP : trigger.bottom + GAP;

	const centred = trigger.left + trigger.width / 2 - card.width / 2;

	return {
		left: Math.min(
			Math.max(MARGIN, centred),
			window.innerWidth - card.width - MARGIN,
		),
		top: Math.max(
			MARGIN,
			Math.min(top, window.innerHeight - card.height - MARGIN),
		),
	};
};

/**
 * Whether a scroll ends the hover in flight: only one of a box containing the
 * trigger, since a swimlane can scroll for longer than the delay.
 */
export const scrollEndsHover = (
	scrolled: {contains?: (other: unknown) => boolean} | null,
	trigger: unknown,
): boolean => {
	// Nothing shown and nothing waiting: there is nothing to dismiss.
	if (!trigger) return false;

	return typeof scrolled?.contains === 'function'
		? scrolled.contains(trigger)
		: true;
};

/**
 * Calls back on anything that should end a hover: click, scroll, resize, key,
 * blur. Returns the teardown.
 */
export const onHoverDismiss = (
	hide: () => void,
	trigger: () => HTMLElement | null,
): (() => void) => {
	const onScroll = (event: Event) => {
		if (scrollEndsHover(event.target as never, trigger())) hide();
	};

	document.addEventListener('mousedown', hide);
	window.addEventListener('scroll', onScroll, true);
	window.addEventListener('resize', hide);
	window.addEventListener('keydown', hide);
	window.addEventListener('blur', hide);

	return () => {
		document.removeEventListener('mousedown', hide);
		window.removeEventListener('scroll', onScroll, true);
		window.removeEventListener('resize', hide);
		window.removeEventListener('keydown', hide);
		window.removeEventListener('blur', hide);
	};
};

// A trigger can leave while its card is up; polled, since late by a quarter
// second is fine.
export const TRIGGER_ALIVE_POLL_MS = 250;
