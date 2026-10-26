import {getState} from '../state/state.js';

type EventLog = ReturnType<typeof getState>['eventLog'];

let indexedLog: EventLog | undefined;
let logAuthors: Set<string> | undefined;

/**
 * Memoised on the log array's identity, which materializing replaces. Ids
 * only; names come from the registry.
 */
const getLogAuthors = (): Set<string> => {
	// May run before boot has populated the log.
	const {eventLog = []} = getState();

	if (logAuthors && indexedLog === eventLog) return logAuthors;

	const authors = new Set<string>();

	for (const event of eventLog) {
		if (event?.userId) authors.add(event.userId);
	}

	indexedLog = eventLog;
	logAuthors = authors;

	return authors;
};

export const hasAuthoredEvents = (contributorId: string): boolean =>
	getLogAuthors().has(contributorId);
