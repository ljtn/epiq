import {getState} from '../state/state.js';
import {sanitizeFilePart} from './file-part.js';

type EventLog = ReturnType<typeof getState>['eventLog'];

/**
 * The log's name is a sanitized file name segment, never better than the
 * registry's for the same name. It wins only when re-encoding shows the two are
 * genuinely different names — a rename, which the registry never sees.
 */
export const preferBestName = (
	registryName: string | undefined,
	logName: string | undefined,
): string | undefined => {
	if (!logName) return registryName;
	if (!registryName) return logName;

	return sanitizeFilePart(registryName) === logName ? registryName : logName;
};

type ContributorLogIndex = {
	latestNames: Map<string, string>;
	authors: Set<string>;
};

let indexedLog: EventLog | undefined;
let logIndex: ContributorLogIndex | undefined;

/**
 * Memoised on the log's array identity. Only safe because materializing
 * replaces the array rather than mutating it, so a stale index is unreachable.
 */
const getContributorLogIndex = (): ContributorLogIndex => {
	// May run before boot has populated the log.
	const {eventLog = []} = getState();

	if (logIndex && indexedLog === eventLog) return logIndex;

	const latestNames = new Map<string, string>();
	const authors = new Set<string>();

	for (const event of eventLog) {
		if (!event?.userId) continue;

		authors.add(event.userId);
		if (event.userName) latestNames.set(event.userId, event.userName);
	}

	indexedLog = eventLog;
	logIndex = {latestNames, authors};

	return logIndex;
};

/**
 * A tombstoned contributor always uses the record, however many events they
 * authored: the log still holds every name they wrote under, so if the
 * override won here a later sync would silently restore the cleared name.
 */
export const getContributorDisplayName = (
	contributorId: string,
	fallback: string,
): string => {
	const {contributors = {}} = getState();

	if (contributors[contributorId]?.tombstoned) return fallback;

	return (
		preferBestName(
			fallback,
			getContributorLogIndex().latestNames.get(contributorId),
		) ?? fallback
	);
};

export const hasAuthoredEvents = (contributorId: string): boolean =>
	getContributorLogIndex().authors.has(contributorId);
