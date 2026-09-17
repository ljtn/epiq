// What every floating thing the pointer summons has in common: how long it
// waits, where it lands, and what makes it go away.
//
// Two of them exist — the plain-text tooltip over the GUI's ~110 `title`s, and
// the card that previews a ticket ref — and they differ only in what counts as
// a trigger and what gets drawn. The rules below are written once so the two
// cannot drift into behaving differently for no reason anybody chose.

// Half the second or so the browser makes you wait: quick enough to feel like
// part of the app, slow enough not to fire on a pointer merely crossing a row
// of controls on its way somewhere else.
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
 * Everything that means "whatever is floating should stop floating": a click,
 * a scroll anywhere (capturing, so a scroll inside a column counts and not
 * just the window's), a resize, a keystroke, the window losing focus.
 *
 * Returns the teardown.
 */
export const onHoverDismiss = (hide: () => void): (() => void) => {
	document.addEventListener('mousedown', hide);
	window.addEventListener('scroll', hide, true);
	window.addEventListener('resize', hide);
	window.addEventListener('keydown', hide);
	window.addEventListener('blur', hide);

	return () => {
		document.removeEventListener('mousedown', hide);
		window.removeEventListener('scroll', hide, true);
		window.removeEventListener('resize', hide);
		window.removeEventListener('keydown', hide);
		window.removeEventListener('blur', hide);
	};
};

// A trigger can leave while its card is up — a row re-rendered under the
// pointer, a panel closing — and takes the card with it. Polled rather than
// observed: the alternative is a MutationObserver over the whole document for
// something that matters a quarter of a second late at worst.
export const TRIGGER_ALIVE_POLL_MS = 250;
