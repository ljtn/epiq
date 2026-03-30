import fs from 'node:fs';
import path from 'node:path';
import {AppEvent} from './event.model.js';
import {PersistedEvent} from './event-persist.js';

const EPIQ_DIR = '.epiq';
const EVENTS_DIR = 'events';

const getEventsDir = (rootDir = process.cwd()) =>
	path.join(rootDir, EPIQ_DIR, EVENTS_DIR);

export function loadAllPersistedEvents(
	rootDir = process.cwd(),
): PersistedEvent[] {
	const dir = getEventsDir(rootDir);
	if (!fs.existsSync(dir)) return [];

	const files = fs
		.readdirSync(dir)
		.filter(file => file.endsWith('.jsonl'))
		.map(file => path.join(dir, file));

	const entries: PersistedEvent[] = [];

	for (const filePath of files) {
		const content = fs.readFileSync(filePath, 'utf8');

		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			entries.push(JSON.parse(trimmed) as PersistedEvent);
		}
	}

	return entries.sort((a, b) => a.eventId.localeCompare(b.eventId));
}

export function loadMergedEvents(rootDir = process.cwd()): AppEvent[] {
	return loadAllPersistedEvents(rootDir).map(({event}) => event);
}
