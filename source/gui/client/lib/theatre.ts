// The board's history played as a movie: what gets played, when each event
// lands, and the clock that walks it. TheatrePlayer draws against this.
//
// Nothing new is asked of the server. The clock walks the timeline the scrubber
// already holds, and each event it reaches checks the board out at that moment
// with the same `time-travel:scrub` a needle drag sends.

import {useCallback, useEffect, useRef, useState} from 'react';
import {buildPlaybackFractions} from '../../../lib/utils/playback-pacing.js';
import {GuiEventTimeline} from './gui-state.model';
import {clamp} from './scrubber';

// One frame of the movie, cut down to what playback, the caption and the
// board's spotlight need.
export type TheatreEvent = {
	id: string;
	t: number;
	label: string;
	// The ticket the event happened to, or null for a board- or swimlane-level
	// one. What the board flashes as the event lands.
	issue: string | null;
};

export type TheatrePlan = {
	events: TheatreEvent[];
	// Ascending, in [0..1]: entry i is where events[i] lands in the movie.
	fractions: number[];
	// The moment the board opens on, before any of it has happened.
	startTime: number;
	endTime: number;
};

// Two events is the shortest thing that is a movie rather than a still.
export const MIN_THEATRE_EVENTS = 2;

// False where the window is too thin to play, and where the server capped it
// and sent buckets alone — counts name no moments to walk.
export const canPlayTimeline = (timeline: GuiEventTimeline | null): boolean =>
	(timeline?.events.length ?? 0) >= MIN_THEATRE_EVENTS;

export const buildTheatrePlan = (
	timeline: GuiEventTimeline,
): TheatrePlan | null => {
	// Sorted here rather than trusted: the log is ordered causally, which is not
	// the same as by the clock, and a movie is watched in clock order.
	const events: TheatreEvent[] = [...timeline.events]
		.sort((left, right) => left.t - right.t)
		.map(entry => ({
			id: entry.id,
			t: entry.t,
			label: entry.label,
			issue: entry.issue,
		}));

	if (events.length < MIN_THEATRE_EVENTS) return null;

	const times = events.map(event => event.t);

	return {
		events,
		fractions: buildPlaybackFractions(times),
		// A tick before the first event, not the window's own start: the movie
		// opens on the board as it was just before any of this happened, with no
		// dead air in front of it.
		startTime: times[0]! - 1,
		endTime: times[times.length - 1]!,
	};
};

// How long the movie runs at 1x. Scaled by the number of events so a handful is
// not padded out to the same length as a year of history, and bounded at both
// ends so neither becomes unwatchable.
const MS_PER_EVENT = 350;
const MIN_DURATION_MS = 6_000;
const MAX_DURATION_MS = 45_000;

// The most playback time one animation frame may advance. See the frame loop.
const MAX_FRAME_MS = 100;

export const theatreDurationMs = (eventCount: number): number =>
	clamp(eventCount * MS_PER_EVENT, MIN_DURATION_MS, MAX_DURATION_MS);

export const THEATRE_SPEEDS = [0.5, 1, 2, 4] as const;

export type TheatreSpeed = (typeof THEATRE_SPEEDS)[number];

export const nextSpeed = (speed: TheatreSpeed): TheatreSpeed =>
	THEATRE_SPEEDS[(THEATRE_SPEEDS.indexOf(speed) + 1) % THEATRE_SPEEDS.length]!;

// The index of the last event whose scheduled position `progress` has reached,
// or -1 before the first one lands. A binary search rather than a walk on from
// the last answer, because dragging the player's bar seeks backwards as readily
// as forwards.
export const cursorAt = (fractions: number[], progress: number): number => {
	let low = 0;
	let high = fractions.length - 1;
	let found = -1;

	while (low <= high) {
		const mid = (low + high) >> 1;

		if (fractions[mid]! <= progress) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return found;
};

// The opening beat, as a share of the movie: the board as it was before any of
// this happened, held long enough to be read as a starting point. Without it
// the first event lands on frame zero, since it is what the clock is measured
// from, and the movie opens one edit in.
export const THEATRE_LEAD_IN = 0.06;

// Where the clock's [0..1] sits in the events themselves, once the opening beat
// is taken off the front. Negative for as long as that beat is running, which
// is the position of a board no event has reached yet.
export const playbackPosition = (progress: number): number =>
	(progress - THEATRE_LEAD_IN) / (1 - THEATRE_LEAD_IN);

// The moment to check the board out at for a cursor. The cut is exclusive,
// hence the +1: what the movie shows is the state the event produced.
export const seekTimeFor = (plan: TheatrePlan, cursor: number): number =>
	cursor < 0 ? plan.startTime : plan.events[cursor]!.t + 1;

// How many played events the log holds. It is a cap on the DOM as much as on
// the reading: rows above this have scrolled up out of the fade, and keeping
// them mounted would grow the overlay by one node per event for the length of
// the movie.
export const THEATRE_LOG_LINES = 24;

// The tail of what has played, oldest first. Sliced off the plan rather than
// accumulated as events land: a seek has to take the log with it, backwards as
// readily as forwards, and a slice of the script is already exactly that.
export const theatreLogEntries = (
	plan: TheatrePlan,
	cursor: number,
): TheatreEvent[] =>
	cursor < 0
		? []
		: plan.events.slice(
				Math.max(0, cursor - THEATRE_LOG_LINES + 1),
				cursor + 1,
		  );

export type TheatrePlayback = {
	// [0..1], off the local clock rather than the events applied, so the bar
	// glides through quiet stretches instead of waiting on the next round trip.
	progress: number;
	cursor: number;
	playing: boolean;
	done: boolean;
	speed: TheatreSpeed;
	// The event that landed last, or null before the first.
	current: TheatreEvent | null;
	currentTime: number;
	totalCount: number;
	toggle: () => void;
	restart: () => void;
	cycleSpeed: () => void;
	seekTo: (fraction: number) => void;
	beginSeek: () => void;
	endSeek: () => void;
};

// `plan` null is a player that is not up; every hook still runs, and the
// playback it hands back is inert.
export const useTheatrePlayback = ({
	plan,
	ack,
	onSeek,
}: {
	plan: TheatrePlan | null;
	// Bumped once per answered time-travel request. What lets the clock hold a
	// seek back rather than stacking another on one the server has not answered.
	ack: number;
	onSeek: (time: number) => void;
}): TheatrePlayback => {
	const [speed, setSpeed] = useState<TheatreSpeed>(1);
	const [playing, setPlaying] = useState(false);
	const [progress, setProgress] = useState(0);
	// A bar being dragged owns the position, so the clock stands aside for it.
	const [seeking, setSeeking] = useState(false);

	// Where the clock actually is. The frame loop advances this and mirrors it
	// into state for rendering; everything that moves the position by hand
	// writes both. Deliberately not re-assigned from `progress` on render: a
	// movie renders on every state broadcast, and one landing between a frame's
	// write and its commit would drag the clock back a frame each time.
	const progressRef = useRef(0);

	const frameRef = useRef<number | null>(null);

	// The cursor last asked for — null when nothing has been, which is not the
	// same as -1, the cursor of the board before the first event.
	const sentCursorRef = useRef<number | null>(null);
	const inflightRef = useRef(false);

	// Held in a ref so the dispatch below turns on the cursor moving and nothing
	// else. The caller re-creates its sender every render, and an effect that
	// listed it would run on each one.
	const onSeekRef = useRef(onSeek);
	onSeekRef.current = onSeek;

	const durationMs = theatreDurationMs(plan?.events.length ?? 0);
	const cursor = plan
		? cursorAt(plan.fractions, playbackPosition(progress))
		: -1;
	const done = plan !== null && progress >= 1;

	// Opens on the first frame and rewinds anything a previous movie left behind.
	useEffect(() => {
		setProgress(0);
		progressRef.current = 0;
		sentCursorRef.current = null;
		inflightRef.current = false;
		setPlaying(plan !== null);
	}, [plan]);

	// Before the dispatch below, so the ack that clears the flag and the render
	// that acts on it are the same one.
	useEffect(() => {
		inflightRef.current = false;
	}, [ack]);

	useEffect(() => {
		if (!plan) return;
		// One request at a time. Events the clock passes meanwhile are not lost —
		// the cursor read on the next attempt covers all of them at once.
		if (inflightRef.current) return;
		if (sentCursorRef.current === cursor) return;

		sentCursorRef.current = cursor;
		inflightRef.current = true;
		onSeekRef.current(seekTimeFor(plan, cursor));
	}, [plan, cursor, ack]);

	useEffect(() => {
		if (!plan || !playing || seeking) return;

		let last = performance.now();

		const step = (now: number) => {
			// Frames stop arriving while the tab is in the background, and the first
			// one back carries the whole gap. Capped, so a movie left in another tab
			// carries on from where it was being watched instead of fast-forwarding
			// to the end — and firing a checkout per event on the way.
			const delta = Math.min(now - last, MAX_FRAME_MS);
			last = now;

			const next = Math.min(
				1,
				progressRef.current + (delta * speed) / durationMs,
			);

			progressRef.current = next;
			setProgress(next);

			if (next >= 1) {
				setPlaying(false);
				return;
			}

			frameRef.current = requestAnimationFrame(step);
		};

		frameRef.current = requestAnimationFrame(step);

		return () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
		};
	}, [plan, playing, seeking, speed, durationMs]);

	const restart = useCallback(() => {
		setProgress(0);
		progressRef.current = 0;
		setPlaying(true);
	}, []);

	const toggle = useCallback(() => {
		// At the end there is nothing to resume, so the transport plays it again.
		if (progressRef.current >= 1) {
			restart();
			return;
		}

		setPlaying(current => !current);
	}, [restart]);

	const cycleSpeed = useCallback(() => setSpeed(nextSpeed), []);

	const seekTo = useCallback((fraction: number) => {
		const next = clamp(fraction, 0, 1);
		progressRef.current = next;
		setProgress(next);

		// Dropped here rather than left to the next frame: the clock stops at the
		// end wherever the end is reached from, and a seek to it while a hidden
		// tab is withholding frames would otherwise still read as playing.
		if (next >= 1) setPlaying(false);
	}, []);

	return {
		progress,
		cursor,
		playing,
		done,
		speed,
		current: plan && cursor >= 0 ? plan.events[cursor]! : null,
		currentTime: plan
			? cursor >= 0
				? plan.events[cursor]!.t
				: plan.startTime
			: 0,
		totalCount: plan?.events.length ?? 0,
		toggle,
		restart,
		cycleSpeed,
		seekTo,
		beginSeek: useCallback(() => setSeeking(true), []),
		endSeek: useCallback(() => setSeeking(false), []),
	};
};

// Mounted with the player, so the board's cards can use them for as long as one
// is up. The flash is what marks the ticket an event just landed on.
export const THEATRE_KEYFRAMES = `
@keyframes epiqTheatreRise {
	from { opacity: 0; transform: translateY(100%); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes epiqTheatreFade {
	from { opacity: 0; }
	to { opacity: 1; }
}
@keyframes epiqTheatreCaption {
	from { opacity: 0; transform: translateY(4px); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes epiqTheatreCardIn {
	from { opacity: 0; transform: scale(0.96); }
	to { opacity: 1; transform: scale(1); }
}
@keyframes epiqTheatreLogLine {
	from { opacity: 0; }
	to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
	@keyframes epiqTheatreRise { from { opacity: 1; transform: none; } to { opacity: 1; transform: none; } }
	@keyframes epiqTheatreCardIn { from { opacity: 1; } to { opacity: 1; } }
	@keyframes epiqTheatreCaption { from { opacity: 1; } to { opacity: 1; } }
	@keyframes epiqTheatreLogLine { from { opacity: 1; } to { opacity: 1; } }
}
`;

export const THEATRE_CARD_IN_ANIMATION = 'epiqTheatreCardIn 260ms ease-out';

// The spotlight on the ticket an event just landed on. Web-animation frames
// rather than a keyframes rule: the card's own entrance owns its `animation`
// property, and this has to be able to run twice in a row on one card.
export const THEATRE_FLASH_FRAMES: Keyframe[] = [
	{
		boxShadow: '0 0 0 0 rgba(118, 212, 255, 0.6)',
		background: 'rgba(118, 212, 255, 0.24)',
	},
	{
		boxShadow: '0 0 0 12px rgba(118, 212, 255, 0)',
		background: 'rgba(118, 212, 255, 0)',
	},
];

export const THEATRE_FLASH_TIMING: KeyframeAnimationOptions = {
	duration: 900,
	easing: 'ease-out',
};

// The height of the player's drawer. The board and the log panel both give it
// up rather than running underneath and playing their last rows behind the
// transport, so the two have to read it from one place.
export const THEATRE_PLAYER_CLEARANCE = 80;

// One row of the log, which is what the whole column shifts by as a line
// arrives. Fixed rather than measured: every row is one clipped line, so the
// shift is the same every time and the crawl stays even.
export const THEATRE_LOG_ROW_HEIGHT = 18;

// The column slides up by a row as each line lands, rather than the stack
// jumping. Run off the element for the same reason the card flash is: lines
// arrive faster than the animation is long, and a restart has to be a restart.
export const THEATRE_CRAWL_FRAMES: Keyframe[] = [
	{transform: `translateY(${THEATRE_LOG_ROW_HEIGHT}px)`},
	{transform: 'translateY(0)'},
];

export const THEATRE_CRAWL_TIMING: KeyframeAnimationOptions = {
	duration: 220,
	easing: 'ease-out',
};
