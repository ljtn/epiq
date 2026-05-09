import {decodeTime} from 'ulid';
import {PersistedEvent} from '../lib/event/event-persist.js';
import {failed, Result, succeeded} from '../lib/model/result-types.js';
import fs from 'node:fs';
import path from 'node:path';

const readFileIfExists = (filePath: string): string | null => {
	if (!fs.existsSync(filePath)) return null;
	return fs.readFileSync(filePath, 'utf8');
};

export const writeFileIfChanged = (
	filePath: string,
	content: string,
): boolean => {
	const existing = readFileIfExists(filePath);

	if (existing === content) {
		return false;
	}

	fs.mkdirSync(path.dirname(filePath), {recursive: true});
	fs.writeFileSync(filePath, content, 'utf8');

	return true;
};

export const parsePersistedEvents = (
	content: string,
): Result<PersistedEvent[]> => {
	const events: PersistedEvent[] = [];

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		try {
			events.push(JSON.parse(trimmed) as PersistedEvent);
		} catch {
			return failed('Failed to parse persisted events');
		}
	}

	return succeeded('Parsed persisted events', events);
};

const getCompositeEventKey = (event: Pick<PersistedEvent, 'id'>): string => {
	const [id, ref] = event.id;
	return `${id}:${ref ?? ''}`;
};

const getEventTime = (event: Pick<PersistedEvent, 'id'>): number => {
	try {
		return decodeTime(event.id[0]);
	} catch {
		return 0;
	}
};

export const mergePersistedEvents = (
	remoteEvents: PersistedEvent[],
	localEvents: PersistedEvent[],
): PersistedEvent[] => {
	const byId = new Map<string, PersistedEvent>();

	for (const event of [...remoteEvents, ...localEvents]) {
		byId.set(getCompositeEventKey(event), event);
	}

	return [...byId.values()].sort((a, b) => {
		const timeDiff = getEventTime(a) - getEventTime(b);

		if (timeDiff !== 0) {
			return timeDiff;
		}

		return getCompositeEventKey(a).localeCompare(getCompositeEventKey(b));
	});
};

export const serializePersistedEvents = (events: PersistedEvent[]): string =>
	events.length === 0
		? ''
		: events.map(event => JSON.stringify(event)).join('\n') + '\n';
