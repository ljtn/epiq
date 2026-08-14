import {getState} from '../state/state.js';

/**
 * The name a contributor should be shown under right now.
 *
 * A contributor record's name is a snapshot written once at
 * `create.contributor` and never updated, so it goes stale the moment someone
 * renames themselves. Renaming starts a new per-actor log file
 * (`<userId>.<userName>.jsonl`), so the log always carries the current name
 * while the record keeps the original.
 *
 * Falls back to the record for anyone with no events, which is what usually
 * keeps a redacted contributor redacted — redaction is only offered to people
 * who have never authored anything.
 *
 * KNOWN BUG (see board: "Redaction is undone by the event-log name
 * override"): that only holds as long as it stays true. If a redacted userId
 * later authors an event, or their log file arrives via a sync, the log name
 * wins here and the cleared name comes back.
 */
export const getContributorDisplayName = (
	contributorId: string,
	fallback: string,
): string => {
	// Tolerates a missing log rather than assuming boot has completed.
	const {eventLog = []} = getState();

	// Backwards: the most recent mention wins, and for an active contributor
	// it is usually found within the last few events.
	for (let index = eventLog.length - 1; index >= 0; index--) {
		const event = eventLog[index];
		if (event?.userId === contributorId && event.userName)
			return event.userName;
	}

	return fallback;
};
