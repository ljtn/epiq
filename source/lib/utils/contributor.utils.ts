import {getState} from '../state/state.js';
import {sanitizeFilePart} from './file-part.js';

type EventLog = ReturnType<typeof getState>['eventLog'];

/**
 * Picks between the name a contributor is registered under and the name their
 * event log file carries.
 *
 * The log's name is not a name — it is a *file name segment*, put through
 * `sanitizeFilePart` on the way to disk and parsed back out of the file name on
 * the way in. "Jonatan Lampa" is written as `jonatan-lampa` and returns as
 * `jonatan-lampa`. So for the same underlying name the log copy is never
 * better than the registry's and usually worse.
 *
 * It still has to win when it carries a genuinely *different* name, which is
 * the staleness this preference exists for: the registry name is written once
 * at `create.contributor` and never updated, so a rename shows up only in the
 * log. Re-encoding the registry name and comparing is what separates the two
 * cases — same name, keep the readable spelling; different name, the log is
 * newer and wins even though it is mangled.
 *
 * Renames therefore still render sanitized. That is a property of encoding the
 * name in the file name at all, not something this can undo; it self-corrects
 * as soon as anything writes a fresh `create.contributor`.
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
 * record, whose name is a stale snapshot after a rename — but only when the
 * two are actually different names, since the log's copy is a sanitized file
 * name segment. See `preferBestName`. Falls back to the record for anyone with
 * no events.
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

	return (
		preferBestName(
			fallback,
			getContributorLogIndex().latestNames.get(contributorId),
		) ?? fallback
	);
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
