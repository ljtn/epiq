// A timeline window through the Rust core. The store derives the entries
// once per state of the log and keeps them; a request pays for its window
// alone, and the whole index never crosses the boundary.
import fs from 'node:fs';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {logSignature} from '../event/log-signature.js';
import {getEventsDirPath} from '../storage/paths.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import type {
	TimelineWindow,
	TimelineWindowRequest,
} from '../../mcp/timeline-index.js';
import {coreCallJson} from './core.js';
import {encodeFrame} from './frame.js';
import {readLogFiles} from './core-load.js';

const PARAMS = '@params';
const encoder = new TextEncoder();

// The log as of the last request the store answered. While it has not moved
// the next request carries no files: a scrub is many windows over one state
// of the log, and stat is all it should cost.
let lastSeen: {dir: string; signature: string} | null = null;

type Answer = {
	entries: TimelineWindow['entries'];
	times: number[];
	earliest: number | null;
	count: number;
};

export const loadTimelineWindowViaCore = (
	stateBranchRoot: string,
	request: TimelineWindowRequest,
): Result<TimelineWindow> => {
	const dir = getEventsDirPath(stateBranchRoot);

	// A missing directory is an empty log, as it is for the loader.
	if (!fs.existsSync(dir)) {
		const windowEnd = request.end ?? request.now;
		const windowStart = request.start ?? windowEnd;

		return succeeded('Empty time window', {
			entries: [],
			times: [],
			earliest: null,
			windowStart,
			windowEnd,
		});
	}

	// Read before the log, never after: a write landing in the gap is then
	// caught by the next request rather than hidden behind a newer signature.
	const signature = logSignature(stateBranchRoot);
	const unchanged =
		lastSeen !== null &&
		lastSeen.dir === dir &&
		lastSeen.signature === signature;

	const params = {
		root: dir,
		now: request.now,
		start: request.start,
		end: request.end,
		boardId: request.boardId,
		cap: request.cap,
		// The well-known tag colours travel with the request, so the table
		// lives in one place.
		tagColors: TAGS_DEFAULT,
	};

	const ask = (withFiles: boolean) =>
		coreCallJson<Answer>(
			'timeline',
			encodeFrame([
				{
					name: PARAMS,
					data: encoder.encode(
						JSON.stringify({...params, unchanged: !withFiles}),
					),
				},
				...(withFiles ? readLogFiles(dir) : []),
			]),
		);

	// A store that holds nothing for this directory yet refuses the short
	// form; the full one starts it.
	let result = unchanged ? ask(false) : null;
	if (result === null || isFail(result)) result = ask(true);
	if (isFail(result) || !result.value) return failed(result.message);

	lastSeen = {dir, signature};

	const {entries, times, earliest} = result.value;
	const windowEnd = request.end ?? request.now;
	const windowStart = request.start ?? earliest ?? windowEnd;

	return succeeded(
		windowEnd <= windowStart ? 'Empty time window' : 'Timeline window',
		{entries, times, earliest, windowStart, windowEnd},
	);
};
