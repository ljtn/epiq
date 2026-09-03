// Where a log line goes when it is clicked.
//
// One question, in one place. The panel stamps the answer onto the row it was
// already drawing; the board acts on it. Neither knows the rule, and neither
// knows the attribute names — `rowAttributes` and `readDestination` are
// inverses of each other and the only two things that do.
//
// Carried on the row as a couple of attributes rather than as a route, a link
// or a handler per line: a window holds up to twenty thousand events, of which
// exactly one is ever followed, so the route is built on the click.

// Type-only on purpose: the styles in `event-log` need the row selector from
// here, and a value import back the other way would close that loop.
import type {LogEntry} from './event-log';
import {categoryOf} from './scrubber';

// The tab a ticket opens on. A comment is read among the comments; everything
// else a line can be about — a title, a description, a tag, an assignee — is
// on the overview.
export type LogTicketTab = 'comments' | 'overview';

export type LogDestination =
	| {kind: 'commit'; sha: string}
	| {kind: 'ticket'; issueId: string; tab: LogTicketTab};

const SHA_ATTRIBUTE = 'data-log-sha';
const ISSUE_ATTRIBUTE = 'data-log-issue';
const TAB_ATTRIBUTE = 'data-log-tab';

// What a click looks for on its way up the tree. Every row that leads anywhere
// carries it; the ones that lead nowhere do not, which is what makes them
// inert without a second check.
export const LOG_ROW_SELECTOR = `[${SHA_ATTRIBUTE}],[${ISSUE_ATTRIBUTE}]`;

const tabFor = (action: string): LogTicketTab =>
	categoryOf(action) === 'comments' ? 'comments' : 'overview';

export const destinationOf = (entry: LogEntry): LogDestination | null => {
	if (entry.sha) return {kind: 'commit', sha: entry.sha};

	// Board- and swimlane-level events happened to no ticket, so there is
	// nowhere to send a reader who clicks one.
	if (!entry.issue || !entry.action) return null;

	return {kind: 'ticket', issueId: entry.issue, tab: tabFor(entry.action)};
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
		  };
};

// The inverse of `rowAttributes`, over a bare lookup rather than an element:
// reading what a row says is not a DOM question, and keeping it out of one
// leaves the pair testable together, which is the only way either is correct.
export const destinationFromAttributes = (
	get: (name: string) => string | null,
): LogDestination | null => {
	const sha = get(SHA_ATTRIBUTE);
	if (sha) return {kind: 'commit', sha};

	const issueId = get(ISSUE_ATTRIBUTE);
	if (!issueId) return null;

	return {
		kind: 'ticket',
		issueId,
		tab: get(TAB_ATTRIBUTE) === 'comments' ? 'comments' : 'overview',
	};
};

// The row a click landed in. Null when the click missed every row that leads
// anywhere — the padding, a day divider, the pane itself.
// The row under a pointer, when that row leads somewhere. The click path asks
// where it goes; the panel asks only where it is, to mark it as a target. Both
// find it the same way, and neither spells the selector out.
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
