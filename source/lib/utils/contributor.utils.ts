import {getState} from '../state/state.js';

type EventLog = ReturnType<typeof getState>['eventLog'];

type ContributorLogIndex = {
	// Latest name each id authored under. The record's name is a snapshot
	// written once at `create.contributor`, so a rename only ever shows up here.
	latestNames: Map<string, string>;
	// Everyone who has authored anything, which is what makes somebody a
	// contributor rather than an outsider.
	authors: Set<string>;
};

let indexedLog: EventLog | undefined;
let logIndex: ContributorLogIndex | undefined;

/**
 * One pass over the event log, reused until the log itself changes.
 *
 * These answers are needed per assignee, per component, on every Ink render —
 * and the worst case was the common one: an external contributor matches
 * nothing, so a scan looking for them read the entire log with no early exit,
 * multiplied by the number of visible tickets, on every keystroke.
 *
 * Keyed on array identity, which is exactly "the log changed": materializing
 * appends with `eventLog: [...s.eventLog, event]` and nothing mutates it in
 * place, so a stale index is not reachable.
 */
const getContributorLogIndex = (): ContributorLogIndex => {
	// Tolerates a missing log rather than assuming boot has completed.
	const {eventLog = []} = getState();

	if (logIndex && indexedLog === eventLog) return logIndex;

	const latestNames = new Map<string, string>();
	const authors = new Set<string>();

	// Forward, so the last write wins: a display name changes over time while
	// the id it belongs to does not.
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
 * The name a contributor should be shown under right now.
 *
 * Prefers the log, which carries the current name, over the contributor
 * record, whose name is a stale snapshot after a rename. Falls back to the
 * record for anyone with no events.
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
	const {contributors = {}} = getState();

	if (contributors[contributorId]?.redacted) return fallback;

	return getContributorLogIndex().latestNames.get(contributorId) ?? fallback;
};

/**
 * Whether this id has authored anything in the workspace. Someone assigned who
 * has not is an outsider, which the UI marks rather than hides — an outsider on
 * a ticket is legitimate, but worth telling apart from a teammate at a glance.
 *
 * Derived from the log, so the marker stops showing the moment they contribute.
 */
export const hasAuthoredEvents = (contributorId: string): boolean =>
	getContributorLogIndex().authors.has(contributorId);
