// Where a log line goes when clicked. `rowAttributes` and `readDestination`
// are inverses, and the only code that knows the attribute names.

// Type-only on purpose: the styles in `event-log` need the row selector from
// here, and a value import back the other way would close that loop.
import type {LogEntry} from './event-log';
import {categoryOf} from './scrubber';

// The tab a ticket opens on: comments for a comment, else the overview.
export type LogTicketTab = 'comments' | 'overview';

export type LogDestination =
	| {kind: 'commit'; sha: string}
	// Narrows the comments tab to one comment; absent from older boards.
	| {
			kind: 'ticket';
			issueId: string;
			tab: LogTicketTab;
			comment?: string;
	  };

const SHA_ATTRIBUTE = 'data-log-sha';
const ISSUE_ATTRIBUTE = 'data-log-issue';
const TAB_ATTRIBUTE = 'data-log-tab';
const COMMENT_ATTRIBUTE = 'data-log-comment';

// Rows that lead nowhere lack these attributes, which makes them inert.
export const LOG_ROW_SELECTOR = `[${SHA_ATTRIBUTE}],[${ISSUE_ATTRIBUTE}]`;

const tabFor = (action: string): LogTicketTab =>
	categoryOf(action) === 'comments' ? 'comments' : 'overview';

export const destinationOf = (entry: LogEntry): LogDestination | null => {
	if (entry.sha) return {kind: 'commit', sha: entry.sha};

	// Board- and swimlane-level events happened to no ticket, so there is
	// nowhere to send a reader who clicks one.
	if (!entry.issue || !entry.action) return null;

	const tab = tabFor(entry.action);

	return tab === 'comments' && entry.target
		? {kind: 'ticket', issueId: entry.issue, tab, comment: entry.target}
		: {kind: 'ticket', issueId: entry.issue, tab};
};

// Spread onto the row. Undefined where the line leads nowhere, so the row is
// left exactly as it was and the selector above cannot match it.
export const rowAttributes = (
	entry: LogEntry,
): Record<string, string> | undefined => {
	const destination = destinationOf(entry);
	if (!destination) return undefined;

	return destination.kind === 'commit'
		? {[SHA_ATTRIBUTE]: destination.sha}
		: {
				[ISSUE_ATTRIBUTE]: destination.issueId,
				[TAB_ATTRIBUTE]: destination.tab,
				...(destination.comment
					? {[COMMENT_ATTRIBUTE]: destination.comment}
					: {}),
		  };
};

// The inverse of `rowAttributes`, over a plain lookup so the pair is testable.
export const destinationFromAttributes = (
	get: (name: string) => string | null,
): LogDestination | null => {
	const sha = get(SHA_ATTRIBUTE);
	if (sha) return {kind: 'commit', sha};

	const issueId = get(ISSUE_ATTRIBUTE);
	if (!issueId) return null;

	const comment = get(COMMENT_ATTRIBUTE);

	return {
		kind: 'ticket',
		issueId,
		tab: get(TAB_ATTRIBUTE) === 'comments' ? 'comments' : 'overview',
		...(comment ? {comment} : {}),
	};
};

// The row under a pointer or click, when that row leads somewhere.
export const linkedRowFrom = (target: EventTarget | null): HTMLElement | null =>
	target instanceof Element
		? target.closest<HTMLElement>(LOG_ROW_SELECTOR)
		: null;

export const readDestination = (
	target: EventTarget | null,
): LogDestination | null => {
	const row = linkedRowFrom(target);

	return row ? destinationFromAttributes(name => row.getAttribute(name)) : null;
};
