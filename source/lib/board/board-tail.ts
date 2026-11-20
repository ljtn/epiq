import {createHash} from 'node:crypto';
import path from 'node:path';
// The board kept current from the log's tail alone, for a process that holds
// no events: after one full boot it reads only what is new, and drops the rest.

import {
	readTail,
	tailFromSeed,
	withOwnLine,
	type LogTail,
} from '../event/log-tail.js';
import {
	accountedSignature,
	accountFor,
	isSettledStamp,
} from '../event/log-signature.js';
import {logSkippedEvents} from '../event/event-materialize.js';
import {onOwnAppend} from '../event/own-append.js';
import {READABLE_SCHEMA_VERSIONS} from '../event/event-envelope.js';
import {
	readSnapshot,
	snapshotKey,
	writeSnapshot,
	type SnapshotKey,
} from '../event/snapshot-file.js';
import {getGlobalConfigDir} from '../storage/global-config-dir.js';
import {nodes} from '../state/node-builder.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getEventsDirPath} from '../storage/paths.js';
import {
	copyBaseState,
	getState,
	initWorkspaceState,
	isStateInitialized,
	restoreBaseState,
	type BaseState,
	updateState,
} from '../state/state.js';
import {EVENT_ACTIONS} from './board-events.model.js';
import {
	bootStateFromEventLog,
	isCheckedOutInThePast,
	reportUnreadableEvents,
} from './board-boot.js';
import {forgetCheckpoints} from './board-checkpoints.js';
import {
	clearEdgeCache,
	decodeReconstructedEvents,
	loadMergedEventsWithUnreadable,
	materializeAll,
	partitionMaterializeResults,
	setEdgeSource,
	tailFromLastLoad,
	type UnreadableEvent,
} from './board-log.js';
import {forgetReplayed} from './board-replayed.js';
import {setHistoryPositions} from './node-history.js';

let enabled = false;

// The tail the state is exactly the replay of, and the events read so far
// that this build could not decode, which keep their place all the same.
let held: {
	root: string;
	tail: LogTail;
	undecodable: UnreadableEvent[];
} | null = null;

/** Turns tail boots on for this process, which then keeps no events. */
export const setTailBoot = (on: boolean): void => {
	enabled = on;
	held = null;
	// The places a ticket's history keeps would point into a log not kept.
	setHistoryPositions(!on);
	setEdgeSource(
		on
			? root =>
					held?.root === root
						? held.tail.spine?.at(-1)?.id[0] ?? null
						: undefined
			: null,
	);
};

export const isTailBoot = (): boolean => enabled;

// What the last boot found it could not read, as a full read lists it.
let unreadableNow: UnreadableEvent[] = [];

/** The log's unreadable lines and events, as of the last boot. */
export const unreadableInLog = (): UnreadableEvent[] => unreadableNow;

// An own write is already applied: the tail takes its line too, or the next
// read would apply it again. Anything unexpected and the next boot is full.
onOwnAppend((root, filePath, line) => {
	if (!enabled || !held || held.root !== root) return;

	const next = withOwnLine(
		getEventsDirPath(root),
		held.tail,
		filePath,
		line,
		isSettledStamp,
	);
	held = next ? {...held, tail: next} : null;
	if (held && ++sinceSaved >= SAVE_EVERY) saveSoon(root);
});

// Nothing below reads an event once applied: let them all go.
const dropEvents = (): void => {
	forgetReplayed();
	forgetCheckpoints();
	clearEdgeCache();
	updateState(state => ({...state, eventLog: []}));
};

// ---------------------------------------------------------------------------
// The tail and the board it describes, saved so the next process starts from
// them rather than the whole log. Only ever a cache.

// Events read since the last save before another is due.
const SAVE_EVERY = 5_000;
let sinceSaved = 0;

// State a save leaves out: no events, and what loading derives again.
const UNSAVED = new Set([
	'eventLog',
	'unappliedEvents',
	'renderedChildrenIndex',
	'replay',
]);

const keyNow = (): SnapshotKey | null =>
	snapshotKey({
		actions: EVENT_ACTIONS,
		schemaVersions: READABLE_SCHEMA_VERSIONS,
		scope: 'mcp-tail',
	});

const snapshotPathFor = (root: string): string =>
	path.join(
		getGlobalConfigDir(),
		'snapshots',
		`${createHash('sha1').update(root).digest('hex')}.snapshot`,
	);

/**
 * Saves the board and the tail it is exactly the replay of: only while
 * both are held and agree, never in the past. True when one was written.
 */
export const saveSnapshot = (root: string): boolean => {
	const key = keyNow();
	if (!enabled || !held || held.root !== root || !key) return false;
	if (isCheckedOutInThePast()) return false;

	const parts: Record<string, unknown> = {
		root,
		tail: held.tail,
		undecodable: held.undecodable,
		unreadable: unreadableNow,
	};
	// The base state only: what is derived is derived again on load.
	for (const [name, value] of Object.entries(copyBaseState(getState()))) {
		if (!UNSAVED.has(name)) parts[`state.${name}`] = value;
	}

	const written = writeSnapshot(snapshotPathFor(root), key, parts);
	if (written) sinceSaved = 0;
	return written;
};

// After the reply that called for it, never inside a request.
const saveSoon = (root: string): void => {
	setTimeout(() => saveSnapshot(root), 0).unref?.();
};

// Roots this process has tried a snapshot for: only a first boot reads one.
const triedSnapshot = new Set<string>();

/** The board and tail a snapshot holds, taken as this process's own. */
const loadSnapshot = (root: string): boolean => {
	if (triedSnapshot.has(root)) return false;
	triedSnapshot.add(root);

	const key = keyNow();
	const parts = key ? readSnapshot(snapshotPathFor(root), key) : null;
	if (!parts || parts['root'] !== root) return false;

	const base: Record<string, unknown> = {
		eventLog: [],
		unappliedEvents: [],
		renderedChildrenIndex: {},
		replay: null,
	};
	for (const [name, value] of Object.entries(parts)) {
		if (name.startsWith('state.')) base[name.slice('state.'.length)] = value;
	}

	if (!isStateInitialized()) {
		const placeholder = initWorkspaceState(
			nodes.workspace('snapshot-placeholder', 'Workspace', 'a0'),
		);
		if (isFail(placeholder)) return false;
	}
	if (isFail(restoreBaseState(base as BaseState))) return false;

	// From another process: nothing it says of a file is taken on trust.
	held = {
		root,
		tail: {...(parts['tail'] as LogTail), verified: false},
		undecodable: parts['undecodable'] as UnreadableEvent[],
	};
	unreadableNow = parts['unreadable'] as UnreadableEvent[];
	return true;
};

/**
 * What `load` returns, with whatever it left held let go after, where this
 * process keeps no events.
 */
export const transientLoad = <T>(load: () => T): T => {
	const result = load();
	if (enabled) clearEdgeCache();
	return result;
};

/**
 * After a full boot: keeps the tail that load read, then lets every event go.
 * `unreadable` is that load's list.
 */
export const adoptTail = (
	root: string,
	unreadable: UnreadableEvent[],
): void => {
	if (!enabled) return;

	const seed = tailFromLastLoad(root);
	held = seed
		? {
				root,
				tail: tailFromSeed(seed),
				undecodable: unreadable.filter(
					entry => entry.reason !== 'corrupt-line',
				),
		  }
		: null;
	dropEvents();
	if (held) saveSoon(root);
};

/**
 * The board brought up to date from the tail alone: true when it was, false
 * where only a full boot is exact.
 */
export const bootFromTail = (root: string): Result<boolean> => {
	if (!enabled || !held || held.root !== root) {
		return succeeded('No tail held', false);
	}
	if (isCheckedOutInThePast()) return succeeded('Checked out', false);

	const read = readTail(getEventsDirPath(root), held.tail, isSettledStamp);
	if ('rebuild' in read) {
		held = null;
		return succeeded(read.rebuild, false);
	}

	const undecodable: UnreadableEvent[] = [];
	const decoded = decodeReconstructedEvents(read.appended, undecodable);
	if (isFail(decoded)) {
		held = null;
		return failed(decoded.message);
	}

	const {fatal, skipped} = partitionMaterializeResults(
		materializeAll(decoded.value, {continues: true}),
	);
	if (fatal.length > 0) {
		// Part applied: only a full boot, which starts from nothing, is exact.
		held = null;
		return succeeded(fatal.map(failure => failure.message).join(', '), false);
	}

	held = {
		root,
		tail: read.tail,
		undecodable: [...held.undecodable, ...undecodable],
	};
	sinceSaved += read.appended.length;
	if (sinceSaved >= SAVE_EVERY) saveSoon(root);
	dropEvents();
	logSkippedEvents(skipped);
	unreadableNow = [...read.quarantined, ...held.undecodable];
	reportUnreadableEvents(unreadableNow);

	return succeeded('Booted from the tail', true);
};

/**
 * The state brought to what the log holds now, `signature` taken before
 * reading it: unchanged, from the tail, or by a full boot.
 */
export const syncBoardWithLog = (
	root: string,
	signature: string,
	// Asked only when the rest says the board is unchanged.
	isLive: () => boolean,
): Result<'unchanged' | 'snapshot' | 'tail' | 'full'> => {
	if (
		accountedSignature(root) === signature &&
		isStateInitialized() &&
		isLive()
	) {
		return succeeded('Unchanged', 'unchanged');
	}

	// A process's first boot starts from a snapshot, where one is good.
	const fromSnapshot = enabled && !held && loadSnapshot(root);

	const fromTail = bootFromTail(root);
	if (isFail(fromTail)) return failed(fromTail.message);
	if (fromTail.value) {
		accountFor(root, signature);
		return succeeded('From the tail', fromSnapshot ? 'snapshot' : 'tail');
	}

	const events = loadMergedEventsWithUnreadable(root);
	if (isFail(events)) return failed(events.message);

	const booted = bootStateFromEventLog(
		events.value.events,
		events.value.unreadable,
	);
	if (isFail(booted)) return failed(booted.message);
	adoptTail(root, events.value.unreadable);
	unreadableNow = events.value.unreadable;

	// Recorded after the boot, so a failed one is retried; writes then advance it.
	accountFor(root, signature);
	return succeeded('Full boot', 'full');
};
