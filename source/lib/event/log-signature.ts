// Whether the log has moved.
//
// Deriving anything from the log — the board, the timeline — costs a pass over
// all of it, and between two reads it has usually not changed at all. This is
// what lets a reader answer "is what I built still true?" without reading the
// log to find out.
//
// Every actor writes its own file, so it covers the directory rather than one
// file: a teammate's events arriving is their file growing, or appearing for the
// first time, and either moves the signature. Append-only means a size that has
// not moved is content that has not moved; mtime catches a file a sync replaced
// wholesale rather than appended to.
//
// Read it BEFORE the log, never after. Any file can gain lines from another
// machine between two reads, sync included: taken first, a write landing in the
// gap is cached under the older signature and rebuilt on the next request.
// Taken afterwards, that write would be stored under the signature of a log it
// does not match, and nothing would ever rebuild it.

import {existsSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {getEventsDirPath} from '../storage/paths.js';

export const logSignature = (stateBranchRoot: string): string => {
	const dir = getEventsDirPath(stateBranchRoot);
	if (!existsSync(dir)) return 'none';

	return readdirSync(dir)
		.filter(file => file.endsWith('.jsonl'))
		.sort()
		.map(file => {
			const {size, mtimeMs} = statSync(path.join(dir, file));

			return `${file}:${size}:${mtimeMs}`;
		})
		.join('|');
};
