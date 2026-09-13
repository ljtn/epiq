// The log read through the Rust core: the files' bytes in, one answer out.
//
// TypeScript keeps everything that touches the file system — the listing, the
// re-list when a file vanishes mid-read, the signature — and the store does
// the rest: envelope, order, effective times, a cut, decoding. What comes back
// is the same shape `event-load.ts` builds itself, so the caller cannot tell
// which side produced it.
//
// A decoded load keeps its events here, by id, and tells the store so: the
// next answer is then the order as ids plus only the events this process has
// not seen, which is a few lines after a write rather than the whole log. The
// objects are the ones state retains in `eventLog` anyway, so the map costs
// its entries, not the events. One events directory at a time, like the store.
import fs from 'node:fs';
import path from 'node:path';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {
	isVanished,
	listEventFiles,
	SCAN_ATTEMPTS,
} from '../event/log-signature.js';
import {coreCallJson} from './core.js';
import {encodeFrame, NamedBytes} from './frame.js';

export type LoadRequest = {
	/** `AppEvent`s out instead of reconstructed ones, unreadable ones quarantined. */
	decode?: boolean;
	/** A cut: applied events before it, `unappliedEvents` at or after it. */
	splitAt?: number;
	/** Every event's effective time, as `[id, time]` pairs. */
	times?: boolean;
	/** Every event's author, in order, as `[userId, userName]` pairs. */
	actors?: boolean;
	/** Leave the events out, for a caller after the edge, times or actors. */
	omitEvents?: boolean;
};

type Unreadable = {
	eventId: string | null;
	reason:
		| 'unsupported-schema-version'
		| 'unknown-action'
		| 'invalid-payload'
		| 'corrupt-line';
	detail: string;
	targetNodeId: string | null;
};

export type CoreLoaded<E> = {
	events: E[];
	unappliedEvents?: E[];
	unreadable: Unreadable[];
	edge: string | null;
	times?: [string, number | null][];
	actors?: [string, string][];
};

// What the store answers a decoded load with once this process caches.
type Handed<E> = {
	order: string[];
	unappliedOrder?: string[];
	fresh: E[];
	unreadable: Unreadable[];
	edge: string | null;
	times?: [string, number | null][];
	actors?: [string, string][];
};

const PARAMS = '@params';
const encoder = new TextEncoder();

let cache: {dir: string; byId: Map<string, unknown>} | null = null;

/**
 * Every log's bytes. A file gone between the listing and its read is one a
 * sync just renamed or git just rewrote; the listing is taken again so the
 * read sees the directory as it is, not as it was.
 */
export const readLogFiles = (dir: string): NamedBytes[] => {
	for (let attempt = 1; ; attempt++) {
		const files: NamedBytes[] = [];
		let listAgain = false;

		for (const name of listEventFiles(dir)) {
			try {
				files.push({name, data: fs.readFileSync(path.join(dir, name))});
			} catch (error) {
				if (!isVanished(error)) throw error;

				if (attempt < SCAN_ATTEMPTS) {
					listAgain = true;
					break;
				}
			}
		}

		if (!listAgain) return files;
	}
};

const callLoad = <T>(
	files: NamedBytes[],
	params: Record<string, unknown>,
): Result<T> => {
	const frame = encodeFrame([
		{name: PARAMS, data: encoder.encode(JSON.stringify(params))},
		...files,
	]);

	const result = coreCallJson<T>('load', frame);
	if (isFail(result) || !result.value) return failed(result.message);

	return succeeded('Loaded the log through epiq-core', result.value);
};

// The answer for a caching process, resolved against the cache. Null when an
// id in the order is one this process never received — the cache and the
// store disagree, and only a full answer settles it.
const resolve = <E extends {id: string}>(
	handed: Handed<E>,
	byId: Map<string, unknown>,
): CoreLoaded<E> | null => {
	for (const event of handed.fresh) byId.set(event.id, event);

	const pick = (order: string[]): E[] | null => {
		const events: E[] = [];

		for (const id of order) {
			const event = byId.get(id) as E | undefined;
			if (!event) return null;
			events.push(event);
		}

		return events;
	};

	const events = pick(handed.order);
	if (!events) return null;

	const unappliedEvents = handed.unappliedOrder
		? pick(handed.unappliedOrder)
		: undefined;
	if (handed.unappliedOrder && !unappliedEvents) return null;

	return {
		events,
		unappliedEvents: unappliedEvents ?? undefined,
		unreadable: handed.unreadable,
		edge: handed.edge,
		times: handed.times,
		actors: handed.actors,
	};
};

/** The whole read, over the files in `dir`, answered by the store. */
export const loadViaCore = <E>(
	dir: string,
	request: LoadRequest,
): Result<CoreLoaded<E>> => {
	const files = readLogFiles(dir);
	const params = {...request, root: dir, now: Date.now()};

	if (!request.decode || request.omitEvents) {
		return callLoad<CoreLoaded<E>>(files, params);
	}

	if (cache && cache.dir === dir) {
		const handed = callLoad<Handed<E & {id: string}>>(files, {
			...params,
			known: true,
		});
		if (isFail(handed) || !handed.value) return failed(handed.message);

		const resolved = resolve(handed.value, cache.byId);
		if (resolved)
			return succeeded('Loaded the log through epiq-core', resolved);
	}

	// No cache for this directory, or one the store no longer agrees with:
	// a full answer, which starts a fresh one.
	const full = callLoad<CoreLoaded<E & {id: string}>>(files, {
		...params,
		known: false,
	});
	if (isFail(full) || !full.value) return failed(full.message);

	const byId = new Map<string, unknown>();
	for (const event of full.value.events) byId.set(event.id, event);
	for (const event of full.value.unappliedEvents ?? [])
		byId.set(event.id, event);
	cache = {dir, byId};

	return succeeded('Loaded the log through epiq-core', full.value);
};

/** `EPIQ_CORE=js` keeps the TypeScript loader, for comparison and as a way out. */
export const useRustCore = (): boolean => process.env['EPIQ_CORE'] !== 'js';
