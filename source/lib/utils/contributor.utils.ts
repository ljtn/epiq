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
 * Falls back to the record for anyone with no events.
 *
 * A redacted contributor always uses the record, however many events they
 * authored. Redaction is a forward event and has to win over the log by
 * construction — the log still holds every name they wrote under, and a
 * redaction that a later `epiq_sync` could undo would not be a redaction.
 */
export const getContributorDisplayName = (
	contributorId: string,
	fallback: string,
): string => {
	// Tolerates a missing log rather than assuming boot has completed.
	const {eventLog = [], contributors = {}} = getState();

	if (contributors[contributorId]?.redacted) return fallback;

	// Backwards: the most recent mention wins, and for an active contributor
	// it is usually found within the last few events.
	for (let index = eventLog.length - 1; index >= 0; index--) {
		const event = eventLog[index];
		if (event?.userId === contributorId && event.userName)
			return event.userName;
	}

	return fallback;
};
