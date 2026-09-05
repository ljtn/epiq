import {clamp} from './layout';

// Must be deterministic per point: Math.random() would reshuffle on every
// re-render, and the scrubber re-renders on hover.
const hashUnitInterval = (key: string): number => {
	let hash = 2166136261;

	for (let index = 0; index < key.length; index++) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return ((hash >>> 0) % 10000) / 10000;
};

const DOT_APPEAR_MS = 260;
const DOT_APPEAR_SCATTER_MS = 620;

const dotDelayMs = (key: string) =>
	Math.round(hashUnitInterval(key) * DOT_APPEAR_SCATTER_MS);

// The same stagger the CSS animation applies, as a number the canvas can draw
// with: 0 before this dot's turn, 1 once it has fully arrived.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;

export const dotEntranceScale = (key: string, elapsedMs: number): number =>
	easeOutCubic(clamp((elapsedMs - dotDelayMs(key)) / DOT_APPEAR_MS, 0, 1));

// The mirror of the entrance, so a series unwinds the way it was drawn: the
// dot that twinkled in last is the first to retract.
export const dotExitScale = (key: string, elapsedMs: number): number =>
	1 -
	easeInCubic(
		clamp(
			(elapsedMs - (DOT_APPEAR_SCATTER_MS - dotDelayMs(key))) / DOT_APPEAR_MS,
			0,
			1,
		),
	);

export const dotAppearAnimation = (key: string): string =>
	`epiqScrubberTwinkle ${DOT_APPEAR_MS}ms ease-out ${dotDelayMs(
		key,
	)}ms backwards`;

// The mirrored delay is what unwinds the scatter the way it was drawn: the dot
// that twinkled in last is the first to retract.
//
// Its own keyframes rather than the twinkle with `direction: reverse` — under
// `reverse` Chrome fills the delay with the `from` frame, so every dot sits at
// scale 0 while it waits and the whole series blinks out at once. `both` on a
// forward animation holds full scale through the wait and zero afterwards,
// which also stops a dot popping back before it is unmounted.
export const dotExitAnimation = (key: string): string =>
	`epiqScrubberRetract ${DOT_APPEAR_MS}ms ease-in ${
		DOT_APPEAR_SCATTER_MS - dotDelayMs(key)
	}ms both`;

// The last dot to leave finishes here, so nothing may unmount before it.
export const DOT_EXIT_TOTAL_MS = DOT_APPEAR_SCATTER_MS + DOT_APPEAR_MS;

// The sweep must stay well longer than one bar's growth, or the crest
// dissolves into everything-at-once.
const BAR_GROW_MS = 200;
const BAR_GROW_SWEEP_MS = 560;

// `backwards` is required, or a bar sits at full height until its delay elapses
// and then snaps to zero.
export const barGrowAnimation = (
	index: number,
	firstIndex: number,
	lastIndex: number,
): string => {
	const span = lastIndex - firstIndex;
	const delay =
		span > 0 ? ((index - firstIndex) / span) * BAR_GROW_SWEEP_MS : 0;

	return `epiqScrubberGrow ${BAR_GROW_MS}ms ease-out ${delay.toFixed(
		0,
	)}ms backwards`;
};

// The whole sweep, after which a newly mounted bar is no longer part of the
// entrance.
export const BAR_ENTRANCE_TOTAL_MS = BAR_GROW_MS + BAR_GROW_SWEEP_MS;

// Belongs on the series wrapper, never on the individual bars or dots: those
// are keyed by bucket time, so a scope change remounts each one and the fade
// restarts per element as a full-chart flash.
export const FADE_IN_ANIMATION = 'epiqScrubberFadeIn 320ms ease-out';

// The one exception to this codebase's inline-style-only convention:
// @keyframes cannot be expressed as a React style object.
export const SCRUBBER_KEYFRAMES = `
	/* Must animate the standalone 'scale' property, not 'transform': the dots
	   carry a 'transform: translate(...)' to centre themselves, and animating
	   'transform' would replace it and fling them off position. */
	@keyframes epiqScrubberTwinkle {
		from { scale: 0; }
		to { scale: 1; }
	}

	/* Not the twinkle reversed — see dotExitAnimation for why. */
	@keyframes epiqScrubberRetract {
		from { scale: 1; }
		to { scale: 0; }
	}

	@keyframes epiqScrubberGrow {
		from { transform: scaleY(0); }
		to { transform: scaleY(1); }
	}

	@keyframes epiqScrubberFadeIn {
		/* Starts faint rather than transparent: from zero the whole chart reads
		   as blinking on a mere data refresh. */
		from { opacity: 0.2; }
		to { opacity: 1; }
	}
`;

// --------------------------------------------------------------------- state
