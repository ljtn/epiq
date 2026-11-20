// Board states along the ordered log, so a cut at a time replays from the
// nearest one before it rather than from genesis.

import v8 from 'node:v8';
import {
	failed,
	isFail,
	Result,
	ReturnFail,
	succeeded,
} from '../model/result-types.js';
import {
	BaseState,
	copyBaseState,
	getState,
	resetState,
	restoreBaseState,
	withDeferredDerive,
} from '../state/state.js';
import {
	appliedAtTime,
	decodeReconstructedEvents,
	extendCutIndex,
	indexForCuts,
	type CutIndex,
	materializeAll,
	partitionMaterializeResults,
	type ReconstructedEvent,
} from './board-log.js';
import {AppEvent} from './board-events.model.js';
import {deepFreeze, FREEZE_EVENTS} from '../event/event-parse.js';

// How many may be held at once: the gap between two, and so the most a cut
// replays, is the log's length over this.
const CHECKPOINT_BUDGET = 32;
// Below this gap, replaying is cheaper than holding the copies.
const MIN_GAP = 2_000;
// No new checkpoint past this share of the heap limit: they buy speed only,
// and a cut still lands exactly from an earlier one or from genesis.
const HEAP_SHARE = 0.6;

type Checkpoint = {
	// The state after applying the order's first `index` entries.
	index: number;
	// Whether genesis is behind it: a later one is then skipped, as in one batch.
	genesisSeen: boolean;
	// Held without its event log, which is a prefix of the longest one held.
	state: BaseState;
	logLength: number;
};

// One log at a time: the order a cut was taken from, and its checkpoints.
let held: {
	key: string;
	entries: ReconstructedEvent[];
	cutIndex: CutIndex;
	gap: number;
	checkpoints: Checkpoint[];
	// The deepest checkpoint's event log: every other one's is a prefix of it.
	log: AppEvent[];
} | null = null;

/** Drops every checkpoint: the next cut builds them again. */
export const forgetCheckpoints = (): void => {
	held = null;
};

// `after` begins with exactly `before`'s entries, the same objects.
const grewFrom = (
	before: ReconstructedEvent[],
	after: ReconstructedEvent[],
): boolean =>
	after.length >= before.length &&
	before.every((entry, index) => after[index] === entry);

const heapAllowsAnother = (): boolean =>
	process.memoryUsage().heapUsed <
	v8.getHeapStatistics().heap_size_limit * HEAP_SHARE;

const isGenesis = (event: AppEvent): boolean =>
	event.action === 'init.workspace';

export type Cut = {applied: number; skipped: ReturnFail[]};

/**
 * Materializes the board as a cut at `targetTime` leaves it, or the live board
 * for null: exactly what a replay of every applied event does. `key` names the log `entries` came from;
 * checkpoints are kept only while it stays the same.
 */
export const materializeCut = (
	key: string,
	loadEntries: () => Result<ReconstructedEvent[]>,
	targetTime: number | null,
	{budget = CHECKPOINT_BUDGET, minGap = MIN_GAP} = {},
): Result<Cut> => {
	if (!held || held.key !== key) {
		const entries = loadEntries();
		if (isFail(entries)) return failed(entries.message);

		// The same entries with own writes after them: every checkpoint still
		// stands, and the index only grows.
		const extended =
			held && grewFrom(held.entries, entries.value)
				? extendCutIndex(held.cutIndex, entries.value, held.entries.length)
				: null;

		held =
			held && extended
				? {...held, key, entries: entries.value, cutIndex: extended}
				: {
						key,
						entries: entries.value,
						cutIndex: indexForCuts(entries.value),
						gap: Math.max(minGap, Math.ceil(entries.value.length / budget)),
						checkpoints: [],
						log: [],
				  };
	}

	const store = held;
	const {entries, cutIndex, gap, checkpoints} = store;
	// Null is the live board: every entry, an undecodable time included,
	// which any cut at a time leaves out.
	const applied =
		targetTime === null
			? new Uint8Array(entries.length).fill(1)
			: appliedAtTime(entries, targetTime, cutIndex);

	// Everything before the first excluded entry is applied: a checkpoint there
	// or earlier is exact, one past it never.
	let firstExcluded = applied.indexOf(0);
	if (firstExcluded === -1) firstExcluded = entries.length;

	const start = checkpoints
		.filter(checkpoint => checkpoint.index <= firstExcluded)
		.at(-1);

	const restored = start
		? restoreBaseState({
				...start.state,
				eventLog: store.log.slice(0, start.logLength),
		  })
		: resetState();
	if (isFail(restored)) return failed(restored.message);

	let genesisSeen = start?.genesisSeen ?? false;
	let index = start?.index ?? 0;
	let count = 0;
	const skipped: ReturnFail[] = [];

	const apply = (slice: ReconstructedEvent[]): Result<null> => {
		const decoded = decodeReconstructedEvents(slice);
		if (isFail(decoded)) return failed(decoded.message);

		const results = materializeAll(decoded.value, {continues: genesisSeen});
		const {fatal, skipped: lost} = partitionMaterializeResults(results);
		if (fatal.length > 0) {
			return failed(fatal.map(failure => failure.message).join(', '));
		}

		for (const failure of lost) skipped.push(failure);
		count += decoded.value.length;
		if (decoded.value.some(isGenesis)) genesisSeen = true;

		return succeeded('Applied', null);
	};

	// One derive at the end: a checkpoint copies only the base state, which
	// each gap's flush keeps current.
	const replayed = withDeferredDerive((): Result<null> => {
		// The applied prefix, a gap at a time, checkpointing each boundary reached.
		while (index < firstExcluded) {
			const next = Math.min(firstExcluded, (Math.floor(index / gap) + 1) * gap);
			const result = apply(entries.slice(index, next));
			if (isFail(result)) return result;
			index = next;

			const known = checkpoints.some(checkpoint => checkpoint.index === index);
			if (index % gap === 0 && !known && heapAllowsAnother()) {
				const state = copyBaseState(getState());
				if (state.eventLog.length > store.log.length)
					store.log = state.eventLog;
				const kept = {...state, eventLog: []};
				// Shares every entry with the live state: none may be written in place.
				if (FREEZE_EVENTS) deepFreeze(kept);
				checkpoints.push({
					index,
					genesisSeen,
					state: kept,
					logLength: state.eventLog.length,
				});
				checkpoints.sort((left, right) => left.index - right.index);
			}
		}

		// Past it, only what the cut applies.
		const rest = entries
			.slice(firstExcluded)
			.filter((_, offset) => applied[firstExcluded + offset]);
		return apply(rest);
	});
	if (isFail(replayed)) return failed(replayed.message);
	if (replayed.value && isFail(replayed.value)) {
		return failed(replayed.value.message);
	}

	return succeeded('Materialized the cut', {applied: count, skipped});
};
