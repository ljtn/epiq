import fs from 'fs';
import path from 'path';
import {decodeTime} from 'ulid';
import {PersistedEvent} from '../event/event-persist.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../lib/command-line/command-types.js';

const getCompositeEventKey = (event: Pick<PersistedEvent, 'id'>): string => {
	const [id, refId] = event.id;
	return `${id}:${refId ?? ''}`;
};

const getEventTime = (event: Pick<PersistedEvent, 'id'>): number => {
	const [id] = event.id;
	return decodeTime(id);
};

const parsePersistedEventsFile = (
	filePath: string,
): Result<PersistedEvent[]> => {
	if (!fs.existsSync(filePath)) {
		return succeeded('Event file missing', []);
	}

	const content = fs.readFileSync(filePath, 'utf8');
	const events: PersistedEvent[] = [];

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		try {
			events.push(JSON.parse(trimmed) as PersistedEvent);
		} catch {
			return failed(`Failed to parse event from ${filePath}: ${trimmed}`);
		}
	}

	return succeeded('Parsed persisted events file', events);
};

const serializePersistedEvents = (events: PersistedEvent[]): string =>
	events.map(event => JSON.stringify(event)).join('\n') + '\n';

const mergePersistedEvents = (
	localEvents: PersistedEvent[],
	remoteEvents: PersistedEvent[],
): PersistedEvent[] => {
	const byId = new Map<string, PersistedEvent>();

	for (const event of [...remoteEvents, ...localEvents]) {
		byId.set(getCompositeEventKey(event), event);
	}

	return [...byId.values()].sort((a, b) => {
		const timeDiff = getEventTime(a) - getEventTime(b);
		if (timeDiff !== 0) return timeDiff;

		return getCompositeEventKey(a).localeCompare(getCompositeEventKey(b));
	});
};

export const mergeEventFile = ({
	sourceFile,
	targetFile,
}: {
	sourceFile: string;
	targetFile: string;
}): Result<boolean> => {
	const sourceResult = parsePersistedEventsFile(sourceFile);
	if (isFail(sourceResult)) return failed(sourceResult.message);

	const targetResult = parsePersistedEventsFile(targetFile);
	if (isFail(targetResult)) return failed(targetResult.message);

	const merged = mergePersistedEvents(targetResult.data, sourceResult.data);
	const nextContent = serializePersistedEvents(merged);

	if (fs.existsSync(targetFile)) {
		const currentContent = fs.readFileSync(targetFile, 'utf8');
		if (currentContent === nextContent) {
			return succeeded('Event file already merged', false);
		}
	}

	fs.mkdirSync(path.dirname(targetFile), {recursive: true});
	fs.writeFileSync(targetFile, nextContent, 'utf8');

	return succeeded('Merged event file', true);
};
