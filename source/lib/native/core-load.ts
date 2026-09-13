// The log read through the Rust core: the files' bytes in, one answer out.
//
// TypeScript keeps everything that touches the file system — the listing, the
// re-list when a file vanishes mid-read, the signature — and the store does
// the rest: envelope, order, effective times, a cut, decoding. What comes back
// is the same shape `event-load.ts` builds itself, so the caller cannot tell
// which side produced it.
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

export type CoreLoaded<E> = {
	events: E[];
	unappliedEvents?: E[];
	unreadable: {
		eventId: string | null;
		reason:
			| 'unsupported-schema-version'
			| 'unknown-action'
			| 'invalid-payload'
			| 'corrupt-line';
		detail: string;
		targetNodeId: string | null;
	}[];
	edge: string | null;
	times?: [string, number | null][];
	actors?: [string, string][];
};

const PARAMS = '@params';
const encoder = new TextEncoder();

/**
 * Every log's bytes. A file gone between the listing and its read is one a
 * sync just renamed or git just rewrote; the listing is taken again so the
 * read sees the directory as it is, not as it was.
 */
const readLogFiles = (dir: string): NamedBytes[] => {
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

/** The whole read, over the files in `dir`, answered by the store. */
export const loadViaCore = <E>(
	dir: string,
	request: LoadRequest,
): Result<CoreLoaded<E>> => {
	const params = {...request, now: Date.now()};
	const frame = encodeFrame([
		{name: PARAMS, data: encoder.encode(JSON.stringify(params))},
		...readLogFiles(dir),
	]);

	const result = coreCallJson<CoreLoaded<E>>('load', frame);
	if (isFail(result) || !result.value) return failed(result.message);

	return succeeded('Loaded the log through epiq-core', result.value);
};

/** `EPIQ_CORE=js` keeps the TypeScript loader, for comparison and as a way out. */
export const useRustCore = (): boolean => process.env['EPIQ_CORE'] !== 'js';
