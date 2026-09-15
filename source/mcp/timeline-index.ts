// The timeline's derived view of the log: every event as the entry a client
// receives, in the order their effective times put them, each carrying the
// board it belongs to.
//
// Built once per state of the log and held, because deriving it is O(the whole
// history) and answering a window off it is O(the window). A board that twenty
// people have worked on for five years is around half a million events; at that
// size the derivation is most of a second and the answer is a hundredth of a
// millisecond.
//
// Rebuilt rather than appended to. `toEffectiveUlidTimes` is a forward scan and
// looks appendable, but the order comes from the causal forest — an event
// synced from another actor lands wherever its `refId` puts it, which is
// routinely in the middle. Appending would be wrong in exactly the case this
// exists for.

import {getEventTime, toEffectiveUlidTimes} from '../lib/event/date-utils.js';
import {AppEvent, EventAction} from '../lib/event/event.model.js';
import {loadMergedEvents} from '../lib/event/event-load.js';
import {logSignature} from '../lib/event/log-signature.js';
import {formatLogAction} from '../lib/event/format-log-utils.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getStringColor} from '../lib/utils/color.js';
import {CLOSED_SWIMLANE_ID} from '../lib/event/static-ids.js';

// Colour resolved here rather than on the client: getStringColor pulls in
// chalk, which the GUI bundle cannot take.
export type EventIdentity = {id: string; name: string; color: string};

export type EventTimelineEntry = {
	// The event's own id, so a client can match a dot to a ticket's log line.
	id: string;
	t: number;
	action: EventAction;
	// Phrased like a TUI log line — "Tagged with bug", "Commented".
	label: string;
	// Who performed the event. On a comment that is its author.
	actor: EventIdentity | null;
	// The tag or contributor the event is *about*, where it has one — the thing
	// the scatter colours a tagging or assigning dot by.
	tag: EventIdentity | null;
	assignee: EventIdentity | null;
	// The ticket the event happened to, where it happened to one. Null for
	// board- and swimlane-level events, which belong to no ticket.
	issue: string | null;
	// The swimlane that ticket sits in once this event has happened, and the
	// one it left where this event moved it out of another — a move, a close or
	// a reopen. Null for an event under no ticket, and `laneBefore` null for one
	// that left the ticket where it was. What lets a window place a ticket
	// without the moves outside it.
	lane: string | null;
	laneBefore: string | null;
};

// Tag, contributor and swimlane names come from the log's own create events
// rather than from the materialized state, which getEventTimeline must not
// touch. Same technique as filterEventsForBoard: build the index as the scan
// proceeds.
//
// A name renamed later reads under the one it was created with, which is what
// the log itself says happened at the moment being described.
const NAMING_ACTIONS = new Set<EventAction>([
	'create.tag',
	'create.contributor',
	// Carries the lane's name, and is what lets a move say which lane it went
	// to.
	'add.swimlane',
]);

const buildNameIndex = (events: AppEvent[]): Map<string, string> => {
	const names = new Map<string, string>();

	for (const event of events) {
		if (!NAMING_ACTIONS.has(event.action)) continue;

		const payload = event.payload as {id?: string; name?: string} | undefined;

		if (payload?.id && payload.name) names.set(payload.id, payload.name);
	}

	return names;
};

// Where each node sat before the move an event describes, keyed by that event's
// id — which is what separates "moved to another lane" from "reordered inside
// the one it was in".
//
// Over the whole log and in causal order, the order loadMergedEvents already
// returns: a move inside the window is only tellable apart from a reorder by
// what came before it, which is routinely outside the window.
const buildPreviousParentIndex = (
	events: AppEvent[],
): Map<string, string | undefined> => {
	const previousParent = new Map<string, string | undefined>();
	const parentByNode = new Map<string, string>();

	for (const event of events) {
		const payload = event.payload as {id?: string; parent?: string} | undefined;

		if (!payload?.id || !payload.parent) continue;

		if (event.action === 'move.node') {
			previousParent.set(event.id, parentByNode.get(payload.id));
		}

		// Creations seed it and moves update it, so the next move reads where
		// this one left the node.
		parentByNode.set(payload.id, payload.parent);
	}

	return previousParent;
};

// Which tag an event is about. Tagging a ticket names it as `tag`; deleting or
// restoring the tag itself names it as the event's own `id`.
const tagOf = (event: AppEvent): string | undefined => {
	// Optional like filterEventsForBoard's: a malformed log entry must not take
	// the whole timeline down with it.
	const payload = event.payload as {id?: string; tag?: string} | undefined;

	return event.action === 'tombstone.tag' || event.action === 'restore.tag'
		? payload?.id
		: payload?.tag;
};

// Which ids are tickets, and what hangs off what: a payload's `id` names a node
// of some kind, and nothing else in it says which kind. Built as the scan
// proceeds, like filterEventsForBoard's.
type IssueIndex = {
	issueIds: Set<string>;
	parentById: Map<string, string>;
};

const buildIssueIndex = (events: AppEvent[]): IssueIndex => {
	const issueIds = new Set<string>();
	const parentById = new Map<string, string>();

	for (const event of events) {
		const payload = event.payload as {id?: string; parent?: string} | undefined;
		const id = payload?.id;
		if (!id) continue;

		if (event.action === 'add.issue') issueIds.add(id);
		if (payload.parent) parentById.set(id, payload.parent);
	}

	return {issueIds, parentById};
};

// Which ticket an event is about. Comments and attachments name it as `issue`,
// their own `id` being the comment's; anything else that happened under a
// ticket — the ticket itself, or a field node hanging off it — is found by
// walking up from the id the event carries.
const issueOf = (
	event: AppEvent,
	{issueIds, parentById}: IssueIndex,
): string | null => {
	const payload = event.payload as {id?: string; issue?: string} | undefined;

	if (payload?.issue) return payload.issue;

	const seen = new Set<string>();
	let current = payload?.id;

	while (current !== undefined && !seen.has(current)) {
		if (issueIds.has(current)) return current;

		seen.add(current);
		current = parentById.get(current);
	}

	return null;
};

// The events that put a ticket in a swimlane. A close is a move to the closed
// lane and a reopen a move back out of it, so both carry a `parent` like a move
// does.
const LANE_ACTIONS = new Set<EventAction>([
	'add.issue',
	'move.node',
	'close.issue',
	'reopen.issue',
]);

type LanePlacement = Pick<EventTimelineEntry, 'lane' | 'laneBefore'>;

// Where each ticket sits after each event, positionally, and where a lane
// change took it from. Over the whole log in order, like the previous-parent
// index: a ticket's lane at any event is set by whichever move came last,
// which is routinely outside the window being asked for.
const lanesForEvents = (
	events: AppEvent[],
	issueIndex: IssueIndex,
): LanePlacement[] => {
	const laneByIssue = new Map<string, string>();

	return events.map(event => {
		const issue = issueOf(event, issueIndex);
		if (issue === null) return {lane: null, laneBefore: null};

		const payload = event.payload as {id?: string; parent?: string} | undefined;
		let laneBefore: string | null = null;

		if (
			LANE_ACTIONS.has(event.action) &&
			payload?.id === issue &&
			payload.parent
		) {
			const previous = laneByIssue.get(issue);
			if (previous !== undefined && previous !== payload.parent) {
				laneBefore = previous;
			}

			laneByIssue.set(issue, payload.parent);
		}

		return {lane: laneByIssue.get(issue) ?? null, laneBefore};
	});
};

// The TUI's phrasing minus the details that need state. A renamed tag reads
// under its original name, which is what the log itself says happened.
// How much of a comment the timeline carries. A window can hold twenty
// thousand events and every one of them is shipped to the browser, so the whole
// body is not on offer — enough to recognise which comment it was.
const COMMENT_PREVIEW_CHARS = 90;

// The first line of a comment, flattened. A body is markdown and often several
// paragraphs; a log line is one line.
const commentPreview = (md: string): string => {
	const firstLine = md.trim().split('\n')[0]?.trim() ?? '';

	return firstLine.length > COMMENT_PREVIEW_CHARS
		? `${firstLine.slice(0, COMMENT_PREVIEW_CHARS).trimEnd()}…`
		: firstLine;
};

const describeTimelineEvent = (
	event: AppEvent,
	names: Map<string, string>,
	previousParents: Map<string, string | undefined>,
): string => {
	const payload = event.payload as
		| {name?: string; assignee?: string; md?: string; parent?: string}
		| undefined;
	const tag = tagOf(event);

	const action = event.action ? formatLogAction(event.action) : '';

	// A comment says what it said, after a colon — "Commented" alone is the one
	// action whose own name tells the reader nothing about it.
	if (payload?.md !== undefined) {
		const preview = commentPreview(payload.md);

		return preview ? `${action}: ${preview}` : action;
	}

	// A move says which lane, and whether it changed lanes at all — "Moved
	// issue" answers neither, and reordering within a lane is the commoner of
	// the two. Falls back to the bare action where the lane has no create event
	// in the log to take a name from.
	if (event.action === 'move.node' && payload?.parent) {
		const lane = names.get(payload.parent);

		if (!lane) return action;

		return previousParents.get(event.id) === payload.parent
			? `Moved within ${lane}`
			: `Moved to ${lane}`;
	}

	const detail =
		tag !== undefined
			? names.get(tag) ?? ''
			: payload?.assignee !== undefined
			? names.get(payload.assignee) ?? ''
			: payload?.name !== undefined
			? `"${payload.name}"`
			: '';

	return [action, detail].filter(Boolean).join(' ');
};

// A referenced id with no create event in the log still gets an entry, under
// the id itself: dropping it would silently thin the filter's list.
const identityFor = (
	id: string | undefined,
	names: Map<string, string>,
	fallback?: string,
): EventIdentity | null => {
	if (!id) return null;

	const name = names.get(id) ?? fallback ?? id;

	return {id, name, color: getStringColor(name)};
};

const identitiesFor = (
	event: AppEvent,
	names: Map<string, string>,
): Pick<EventTimelineEntry, 'actor' | 'tag' | 'assignee'> => {
	const payload = event.payload as {assignee?: string} | undefined;

	return {
		// Through the same name index the tag and the assignee go through. The
		// name on a loaded event is not a name: it is parsed back out of the log
		// file, which `sanitizeFilePart` lowercased and stripped, so an actor read
		// straight off it turns up as `claude-adolph` beside the `claude/adolph`
		// they are assigned under — in a different colour, since the colour is
		// hashed from whichever spelling is in hand. The file's copy is the
		// fallback and nothing more: an id the log has no `create.contributor`
		// for, from a board written before renames were events.
		actor: identityFor(event.userId, names, event.userName),
		tag: identityFor(tagOf(event), names),
		assignee: identityFor(payload?.assignee, names),
	};
};

// Which board each event belongs to, positionally. The id -> parent map is
// built as the scan proceeds, so each event is attributed using the hierarchy
// as it stood then.
//
// Resolved once here rather than per request: walking every event's parent
// chain is O(the whole history), and a window needs it for its own events only.
const boardsForEvents = (events: AppEvent[]): (string | null)[] => {
	const parentById = new Map<string, string>();
	const boardIds = new Set<string>();

	const resolveBoard = (id: string): string | null => {
		const seen = new Set<string>();
		let current: string | undefined = id;

		while (current && !seen.has(current)) {
			if (boardIds.has(current)) return current;
			seen.add(current);
			current = parentById.get(current);
		}

		return null;
	};

	return events.map(event => {
		const payload = event.payload as {
			id?: string;
			parent?: string;
			issue?: string;
		};
		const id = payload?.id;
		if (!id) return null;

		// Before resolving, so a board's own add event is attributed to it.
		if (event.action === 'add.board') boardIds.add(id);

		// A close moves the ticket into the closed lane, which hangs off the
		// Closed board — so read where it stood first, or the close belongs to
		// the board nobody was looking at and the ticket's own board never sees
		// it leave.
		const closedFrom = event.action === 'close.issue' ? resolveBoard(id) : null;

		// Comments and attachments hang off `issue`: their `id` is the comment's
		// or attachment's own, so without this they resolve to no board at all
		// and drop out of every board-scoped view.
		const parent = payload.parent ?? payload.issue;
		if (parent) parentById.set(id, parent);

		if (closedFrom !== null) return closedFrom;

		// A board is its own board, which is what keeps its add and its edits in
		// its own timeline.
		return boardIds.has(id) ? id : resolveBoard(id);
	});
};

// Events with no board are dropped, as they always were.
export const filterEventsForBoard = (
	events: AppEvent[],
	boardId: string,
): AppEvent[] => {
	const boards = boardsForEvents(events);

	return events.filter((_, index) => boards[index] === boardId);
};

// One event, ready to send. `board` is not part of what a client receives — it
// is how a request narrows to its own board without walking the log again.
export type TimelineEntry = EventTimelineEntry & {board: string | null};

// Every event the log holds, in effective-time order.
export const buildTimelineEntries = (events: AppEvent[]): TimelineEntry[] => {
	const names = buildNameIndex(events);
	const previousParents = buildPreviousParentIndex(events);
	const issueIndex = buildIssueIndex(events);
	const lanes = lanesForEvents(events, issueIndex);
	const boards = boardsForEvents(events);

	// Over the whole log, so a poisoned id's dot lands where the scrub and
	// checkout paths will cut.
	const effectiveTimes = toEffectiveUlidTimes(
		events.map(event => getEventTime(event)),
	);

	const entries = events.flatMap((event, index) => {
		const t = effectiveTimes[index] ?? null;

		return t === null
			? []
			: [
					{
						id: event.id,
						t,
						action: event.action,
						label: describeTimelineEvent(event, names, previousParents),
						issue: issueOf(event, issueIndex),
						...lanes[index]!,
						board: boards[index] ?? null,
						...identitiesFor(event, names),
					},
			  ];
	});

	// Sorted here rather than per request: effective times are not the order the
	// log is stored in, and a window is a range over this axis.
	return entries.sort((left, right) => left.t - right.t);
};

// One change of lane: the ticket sits in `lane`, on `board`, from `t` until
// the next change.
type LaneChange = {t: number; lane: string; board: string | null};

// Every ticket's lane over time, in time order, for answering where each one
// sat at any moment without walking the entries up to it.
export type LaneIndex = ReadonlyMap<string, readonly LaneChange[]>;

export const buildLaneIndex = (
	entries: readonly TimelineEntry[],
): LaneIndex => {
	const index = new Map<string, LaneChange[]>();

	for (const entry of entries) {
		if (entry.issue === null || entry.lane === null) continue;

		const changes = index.get(entry.issue) ?? [];
		const last = changes[changes.length - 1];

		if (last === undefined || last.lane !== entry.lane) {
			changes.push({t: entry.t, lane: entry.lane, board: entry.board});
			index.set(entry.issue, changes);
		}
	}

	return index;
};

// The last change strictly before `t`, or undefined where the ticket did not
// yet exist.
const changeBefore = (
	changes: readonly LaneChange[],
	t: number,
): LaneChange | undefined => {
	let low = 0;
	let high = changes.length;

	while (low < high) {
		const mid = (low + high) >> 1;

		if (changes[mid]!.t < t) low = mid + 1;
		else high = mid;
	}

	return changes[low - 1];
};

// The lane of every ticket open at a moment, by ticket id — what lets a window
// draw the tickets that sat still through it. Closed tickets are left out: the
// flow chart ends a line at its close, and a ticket closed before the window
// has no line in it. Narrowed to a board where one is named, by the board the
// ticket was on at that moment.
export const lanesOpenAt = (
	index: LaneIndex,
	t: number,
	boardId?: string,
): Record<string, string> => {
	const lanes: Record<string, string> = {};

	for (const [issue, changes] of index) {
		const change = changeBefore(changes, t);
		if (change === undefined || change.lane === CLOSED_SWIMLANE_ID) continue;
		if (boardId && change.board !== boardId) continue;

		lanes[issue] = change.lane;
	}

	return lanes;
};

// Every swimlane the log ever created, under its last known name — renamed
// where it was renamed — so a lane the board has since deleted can still be
// named on a chart drawn from its history.
export const buildLaneNames = (events: AppEvent[]): Record<string, string> => {
	const lanes: Record<string, string> = {};

	for (const event of events) {
		const payload = event.payload as {id?: string; name?: string} | undefined;
		if (!payload?.id || payload.name === undefined) continue;

		if (event.action === 'add.swimlane') lanes[payload.id] = payload.name;
		else if (event.action === 'edit.title' && payload.id in lanes) {
			lanes[payload.id] = payload.name;
		}
	}

	return lanes;
};

export type TimelineIndex = {
	entries: readonly TimelineEntry[];
	lanes: LaneIndex;
	laneNames: Record<string, string>;
};

// Held for the life of the process, and only ever for one root: the GUI server
// serves one project, and a second entry would be a second copy of a history
// this large.
let cache: {root: string; signature: string; index: TimelineIndex} | null =
	null;

// The whole log as timeline entries, with the lane index over them, rebuilt
// only when the log has moved. The raw events are dropped on the way out —
// they are three times the weight of what is derived from them, and nothing
// downstream of here reads them.
export const getTimelineIndex = (
	stateBranchRoot: string,
): Result<TimelineIndex> => {
	// Read before the log, never after. Any file can gain lines from another
	// machine between two reads, sync included: taken first, a write that lands
	// in the gap is cached under the older signature and rebuilt on the next
	// request. Taken afterwards, those same entries would be stored under the
	// signature of a log they do not match, and nothing would ever rebuild them.
	const signature = logSignature(stateBranchRoot);

	if (
		cache &&
		cache.root === stateBranchRoot &&
		cache.signature === signature
	) {
		return succeeded('Timeline entries, cached', cache.index);
	}

	const eventsResult = loadMergedEvents(stateBranchRoot);
	if (isFail(eventsResult)) return failed(eventsResult.message);

	const entries = buildTimelineEntries(eventsResult.value);
	const index = {
		entries,
		lanes: buildLaneIndex(entries),
		laneNames: buildLaneNames(eventsResult.value),
	};

	cache = {root: stateBranchRoot, signature, index};

	return succeeded('Timeline entries, built', index);
};

export const getTimelineEntries = (
	stateBranchRoot: string,
): Result<readonly TimelineEntry[]> => {
	const result = getTimelineIndex(stateBranchRoot);
	return isFail(result)
		? result
		: succeeded(result.message, result.value.entries);
};

// The tests drive the log through a mocked loader, so they need the cache gone
// between cases; a signature is no help where the files never existed.
export const clearTimelineCache = (): void => {
	cache = null;
};
