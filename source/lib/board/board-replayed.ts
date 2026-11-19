// What the materialized state was last replayed from, so a reload that only
// adds to the log applies just the addition.

import {isFail} from '../model/result-types.js';
import {getSafeState} from '../state/state.js';
import {AppEvent} from './board-events.model.js';

// Off by default: the TUI changes state outside the log (a move's preview, its
// own list nodes), so only a full replay is exact there. The GUI server and the
// MCP hold nothing but what events derive, and turn it on.
let suffixReplayAllowed = false;

export const setSuffixReplay = (allowed: boolean): void => {
	suffixReplayAllowed = allowed;
	if (!allowed) replayed = null;
};

// Every event replayed, applied or skipped, and where the state's own log
// stood after it. Writes since are on that log.
let replayed: {
	input: AppEvent[];
	appliedCount: number;
	lastApplied: AppEvent;
} | null = null;

/** The next reload replays in full: the state no longer matches the record. */
export const forgetReplayed = (): void => {
	replayed = null;
};

export const rememberReplayed = (events: AppEvent[]): void => {
	const stateResult = getSafeState();
	const eventLog = isFail(stateResult) ? [] : stateResult.value.eventLog;
	const lastApplied = eventLog.at(-1);

	replayed = lastApplied
		? {input: events, appliedCount: eventLog.length, lastApplied}
		: null;
};

const sameEvent = (left: AppEvent, right: AppEvent): boolean =>
	left === right ||
	(left.id === right.id &&
		left.action === right.action &&
		left.userId === right.userId &&
		(left.payload === right.payload ||
			JSON.stringify(left.payload) === JSON.stringify(right.payload)));

/**
 * The events past what the state holds, or null where only a full replay is
 * exact: the state was rebuilt since, is not live, or is no prefix of `events`.
 */
export const unappliedSuffix = (events: AppEvent[]): AppEvent[] | null => {
	const stateResult = getSafeState();
	if (!suffixReplayAllowed || !replayed || isFail(stateResult)) return null;

	const {eventLog, timeMode, replay} = stateResult.value;
	if (timeMode !== 'live' || replay !== null) return null;

	// The same event object where the replay left it, or the log was rebuilt.
	if (eventLog[replayed.appliedCount - 1] !== replayed.lastApplied) {
		return null;
	}

	const ownWrites = eventLog.slice(replayed.appliedCount);
	const held = replayed.input.length + ownWrites.length;
	if (events.length < held) return null;

	for (let index = 0; index < held; index++) {
		const previous =
			index < replayed.input.length
				? replayed.input[index]!
				: ownWrites[index - replayed.input.length]!;

		if (!sameEvent(previous, events[index]!)) return null;
	}

	return events.slice(held);
};
