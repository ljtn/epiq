// Reads ids straight off the persisted logs rather than through the event
// decoder, so an event this build cannot interpret still counts as present.
// Losing one is data loss whether or not we can read it.
import fs from 'node:fs';
import path from 'node:path';
import {trackedFileNameFor} from '../../lib/event/pending-log.js';

const eventsDir = (stateBranchRoot: string): string =>
	path.join(stateBranchRoot, '.epiq', 'events');

const idsInFile = (filePath: string): string[] => {
	const ids: string[] = [];

	for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		try {
			const id = (JSON.parse(trimmed) as {id?: [string, string | null]}).id;
			if (Array.isArray(id) && typeof id[0] === 'string') ids.push(id[0]);
		} catch {
			// A half-written line is itself worth reporting, but the caller only
			// asks about ids, and a malformed one has none to give.
		}
	}

	return ids;
};

/**
 * What this actor has written — including what it has not synced yet.
 *
 * An append lands in the pending log and stays there until a sync folds it into
 * the tracked one, so reading the tracked file alone answers "what have I
 * published", which is a different question and reads as nothing at all for
 * somebody working offline. Every pending file of the actor's counts — live,
 * rotated or folded — since a flush part-way through leaves lines in any of them.
 */
export const readOwnEventIds = (
	stateBranchRoot: string,
	fileName: string,
): string[] => {
	const dir = eventsDir(stateBranchRoot);
	if (!fs.existsSync(dir)) return [];

	return fs
		.readdirSync(dir)
		.filter(name => name === fileName || trackedFileNameFor(name) === fileName)
		.flatMap(name => idsInFile(path.join(dir, name)));
};

export const readEventIds = (stateBranchRoot: string): string[] => {
	const dir = eventsDir(stateBranchRoot);
	if (!fs.existsSync(dir)) return [];

	return fs
		.readdirSync(dir)
		.filter(name => name.endsWith('.jsonl'))
		.flatMap(name => idsInFile(path.join(dir, name)));
};
