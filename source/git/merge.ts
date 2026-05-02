import fs from 'node:fs';
import path from 'node:path';
import {decodeTime} from 'ulid';
import {parsePersistedEventsFile} from '../event/event-load.js';
import {PersistedEvent} from '../event/event-persist.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';

const getCompositeEventKey = (event: Pick<PersistedEvent, 'id'>): string => {
	const [id, refId] = event.id;
	return `${id}:${refId ?? ''}`;
};

const getEventTime = (event: Pick<PersistedEvent, 'id'>): number => {
	const [id] = event.id;
	return decodeTime(id);
};

const toPersistedEventOnly = (event: PersistedEvent): PersistedEvent => {
	const {userId, userName, ...persistedEvent} = event as PersistedEvent & {
		userId?: string;
		userName?: string;
	};

	return persistedEvent;
};

const serializePersistedEvents = (events: PersistedEvent[]): string =>
	events.length === 0
		? ''
		: events
				.map(event => JSON.stringify(toPersistedEventOnly(event)))
				.join('\n') + '\n';

export const mergePersistedEvents = (
	targetEvents: PersistedEvent[],
	sourceEvents: PersistedEvent[],
): PersistedEvent[] => {
	const byId = new Map<string, PersistedEvent>();

	for (const event of [...sourceEvents, ...targetEvents]) {
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

	const merged = mergePersistedEvents(targetResult.value, sourceResult.value);
	const nextContent = serializePersistedEvents(merged);
	const currentContent = fs.existsSync(targetFile)
		? fs.readFileSync(targetFile, 'utf8')
		: '';

	if (currentContent === nextContent) {
		return succeeded('Event file already merged', false);
	}

	fs.mkdirSync(path.dirname(targetFile), {recursive: true});
	fs.writeFileSync(targetFile, nextContent, 'utf8');

	return succeeded('Merged event file', true);
};
