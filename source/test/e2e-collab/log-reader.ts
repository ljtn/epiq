// Reads ids straight off the persisted logs rather than through the event
// decoder, so an event this build cannot interpret still counts as present.
// Losing one is data loss whether or not we can read it.
import fs from 'node:fs';
import path from 'node:path';

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

export const readOwnEventIds = (
	stateBranchRoot: string,
	fileName: string,
): string[] => {
	const filePath = path.join(eventsDir(stateBranchRoot), fileName);

	return fs.existsSync(filePath) ? idsInFile(filePath) : [];
};

export const readEventIds = (stateBranchRoot: string): string[] => {
	const dir = eventsDir(stateBranchRoot);
	if (!fs.existsSync(dir)) return [];

	return fs
		.readdirSync(dir)
		.filter(name => name.endsWith('.jsonl'))
		.flatMap(name => idsInFile(path.join(dir, name)));
};
