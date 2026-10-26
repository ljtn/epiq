// Reads ids straight off the logs, so an event this build can't decode still counts.
import fs from 'node:fs';
import path from 'node:path';
import {actorSegmentOf} from '../../lib/event/pending-log.js';

const eventsDir = (stateBranchRoot: string): string =>
	path.join(stateBranchRoot, '.epiq', 'events');

// A file gone since listing is a sync rebasing underneath, not a failure; ids are
// read again once actors settle.
const readLogFile = (filePath: string): string => {
	try {
		return fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';

		throw error;
	}
};

const idsInFile = (filePath: string): string[] => {
	const ids: string[] = [];

	for (const line of readLogFile(filePath).split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		try {
			const id = (JSON.parse(trimmed) as {id?: [string, string | null]}).id;
			if (Array.isArray(id) && typeof id[0] === 'string') ids.push(id[0]);
		} catch {
			// A malformed line has no id to give.
		}
	}

	return ids;
};

/**
 * What this actor has written, synced or not: its tracked log and every pending
 * file. Matched by actor id, so logs under an older name count too.
 */
export const readOwnEventIds = (
	stateBranchRoot: string,
	fileName: string,
): string[] => {
	const dir = eventsDir(stateBranchRoot);
	if (!fs.existsSync(dir)) return [];

	return fs
		.readdirSync(dir)
		.filter(
			name =>
				name.endsWith('.jsonl') &&
				actorSegmentOf(name) === actorSegmentOf(fileName),
		)
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
