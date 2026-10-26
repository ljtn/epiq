// The timeline's view of the log: every event as a client entry, in effective
// time order, with its board. Held per log state and rebuilt, never appended:
// a synced event can land mid-order.

import {getEventTime, toEffectiveUlidTimes} from '../lib/event/date-utils.js';
import {AppEvent, EventAction} from '../lib/board/board-events.model.js';
import {loadActorNames, loadMergedEvents} from '../lib/board/board-log.js';
import {logSignature} from '../lib/event/log-signature.js';
import {formatLogAction} from '../lib/board/format-log-utils.js';
import {describeRepoEvent, isRepoAction} from '../lib/board/board-repos.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {projectLogNames} from '../lib/board/log-names.js';
import {Identity, identityOf} from '../lib/model/identity.js';
import {nodeRef} from '../lib/utils/node-ref.js';
import {CLOSED_SWIMLANE_ID} from '../lib/board/static-ids.js';

// The same shape every surface labels somebody with, and resolved the same
// way — see `identityOf`.
export type EventIdentity = Identity;

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
	// The comment the event happened to, or null.
	target: string | null;
	// The ticket's lane after this event, and the one a move, close or reopen
	// took it from; lets a window place a ticket without the moves outside it.
	lane: string | null;
	laneBefore: string | null;
};

// Each node's parent before an event's move, keyed by event id: tells a lane
// change from a reorder. Over the whole log, since the context precedes the window.
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

// Which ids are tickets, and what hangs off what, built as the scan proceeds.
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

// Which ticket an event is about: `issue` for comments and attachments,
// otherwise found by walking up from the event's id.
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

// The events about a comment; each carries the comment's id as its payload id.
const COMMENT_ACTIONS = new Set<EventAction>([
	'add.issue.comment',
	'edit.issue.comment',
	'delete.issue.comment',
]);

// The comment inside the ticket the event happened to, read off the payload.
const targetOf = (event: AppEvent): string | null => {
	if (!COMMENT_ACTIONS.has(event.action)) return null;

	const payload = event.payload as {id?: string} | undefined;

	return payload?.id ?? null;
};

// The events that put a ticket in a swimlane; close and reopen are moves too.
const LANE_ACTIONS = new Set<EventAction>([
	'add.issue',
	'move.node',
	'close.issue',
	'reopen.issue',
]);

type LanePlacement = Pick<EventTimelineEntry, 'lane' | 'laneBefore'>;

// Each ticket's lane after each event, and where a lane change took it from.
// Over the whole log, since the last move is often outside the window.
const lanesForEvents = (
	events: AppEvent[],
	// Each event's ticket, positionally — resolved once by the caller, which
	// needs it for the entry as well.
	issues: readonly (string | null)[],
): LanePlacement[] => {
	const laneByIssue = new Map<string, string>();

	return events.map((event, index) => {
		const issue = issues[index] ?? null;
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

// A lane or board event's subject as it stood when written: its kind and its
// previous name, tracked over the whole log so a rename reads from the old name.
type Subject = {kind: 'board' | 'swimlane'; name: string | undefined};

const subjectsForEvents = (events: AppEvent[]): (Subject | null)[] => {
	const kinds = new Map<string, Subject['kind']>();
	const nameById = new Map<string, string>();

	return events.map(event => {
		const {id, name} = (event.payload ?? {}) as {id?: string; name?: string};
		if (!id) return null;

		if (event.action === 'add.board') kinds.set(id, 'board');
		if (event.action === 'add.swimlane') kinds.set(id, 'swimlane');

		const kind = kinds.get(id);
		if (!kind) return null;

		const subject = {kind, name: nameById.get(id) ?? name};
		const named =
			event.action === 'edit.title' || event.action.startsWith('add.');
		if (named && name !== undefined) nameById.set(id, name);

		return subject;
	});
};

// How much of a comment the timeline ships: every event in a window goes to
// the browser.
const COMMENT_PREVIEW_CHARS = 90;

// The first line of a comment, flattened. A body is markdown and often several
// paragraphs; a log line is one line.
const commentPreview = (md: string): string => {
	const firstLine = md.trim().split('\n')[0]?.trim() ?? '';

	return firstLine.length > COMMENT_PREVIEW_CHARS
		? `${firstLine.slice(0, COMMENT_PREVIEW_CHARS).trimEnd()}…`
		: firstLine;
};

const subjectOf = ({kind, name}: Subject): string =>
	name === undefined ? kind : `${kind} "${name}"`;

// A lane's or board's own line, naming kind and name first. Null where the
// generic wording says enough.
const describeSubjectEvent = (
	event: AppEvent,
	subject: Subject,
	names: ReadonlyMap<string, string>,
	previousParents: Map<string, string | undefined>,
): string | null => {
	const {name, parent} = (event.payload ?? {}) as {
		name?: string;
		parent?: string;
	};
	const what = subjectOf(subject);

	switch (event.action) {
		case 'move.node': {
			// A board's parent is the workspace, which is not worth naming.
			if (subject.kind === 'board' || !parent) return `Moved ${what}`;
			const board = names.get(parent);
			if (!board) return `Moved ${what}`;

			return previousParents.get(event.id) === parent
				? `Moved ${what} within ${board}`
				: `Moved ${what} to ${board}`;
		}

		case 'edit.title':
			return name === undefined
				? `Renamed ${what}`
				: `Renamed ${what} to "${name}"`;
		case 'delete.node':
			return `Deleted ${what}`;
		case 'lock.node':
			return `Locked ${what}`;
		default:
			return null;
	}
};

const describeTimelineEvent = (
	event: AppEvent,
	names: ReadonlyMap<string, string>,
	previousParents: Map<string, string | undefined>,
	issue: string | null,
	subject: Subject | null,
): string => {
	const payload = event.payload as
		| {
				id?: string;
				name?: string;
				assignee?: string;
				md?: string;
				parent?: string;
				email?: string;
		  }
		| undefined;
	const tag = tagOf(event);

	const action = event.action ? formatLogAction(event.action) : '';

	// A comment says what it said, after a colon — "Commented" alone is the one
	// action whose own name tells the reader nothing about it.
	if (payload?.md !== undefined) {
		const preview = commentPreview(payload.md);

		// A board's or lane's description belongs to no ticket, so the line names
		// what it belongs to.
		const head =
			event.action === 'edit.description' && !issue && subject
				? `${action} of ${subjectOf(subject)}`
				: action;

		return preview ? `${head}: ${preview}` : head;
	}

	// A move names its lane and whether it changed lanes; bare action when the
	// lane has no create event to name it.
	if (subject && !issue) {
		const described = describeSubjectEvent(
			event,
			subject,
			names,
			previousParents,
		);
		if (described) return described;
	}

	// A ticket's move opens with its ref, as a commit line does: the board-wide
	// log otherwise never says which ticket moved.
	if (event.action === 'move.node' && payload?.parent) {
		const lane = names.get(payload.parent);
		const moved = issue ? `${nodeRef(issue)} moved` : 'Moved';

		if (!lane) return issue ? moved : action;

		return previousParents.get(event.id) === payload.parent
			? `${moved} within ${lane}`
			: `${moved} to ${lane}`;
	}

	// So does a close or a reopen, which is otherwise one bare word.
	if (
		(event.action === 'close.issue' || event.action === 'reopen.issue') &&
		issue
	) {
		return `${nodeRef(issue)} ${action.toLowerCase()}`;
	}

	if (isRepoAction(event.action)) {
		return [action, describeRepoEvent(event)].filter(Boolean).join(' ');
	}

	const detail =
		tag !== undefined
			? names.get(tag) ?? ''
			: payload?.assignee !== undefined
			? names.get(payload.assignee) ?? ''
			: // The address a claim is about, so two claims on one address are visible.
			payload?.email !== undefined
			? payload.email
			: payload?.name !== undefined
			? `"${payload.name}"`
			: '';

	return [action, detail].filter(Boolean).join(' ');
};

// A referenced id the log never named still gets an entry, under the id
// itself: dropping it would silently thin the filter's list.
const identityFor = (
	id: string | undefined,
	names: ReadonlyMap<string, string>,
): EventIdentity | null => (id ? identityOf(id, names.get(id)) : null);

const identitiesFor = (
	event: AppEvent,
	names: ReadonlyMap<string, string>,
): Pick<EventTimelineEntry, 'actor' | 'tag' | 'assignee'> => {
	const payload = event.payload as {assignee?: string} | undefined;

	return {
		// Resolved by id through the name index; the log file's sanitized name is
		// only a fallback for actors the log never names.
		actor: identityFor(event.userId, names),
		tag: identityFor(tagOf(event), names),
		assignee: identityFor(payload?.assignee, names),
	};
};

// Which board each event belongs to, using the hierarchy as it stood then.
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

		// A close moves the ticket under the Closed board, so read where it stood
		// first, or its own board never sees it leave.
		const closedFrom = event.action === 'close.issue' ? resolveBoard(id) : null;

		// Comments and attachments hang off `issue`; their own `id` resolves to no board.
		const parent = payload.parent ?? payload.issue;
		if (parent) parentById.set(id, parent);

		if (closedFrom !== null) return closedFrom;

		// A board is its own board, which is what keeps its add and its edits in
		// its own timeline.
		return boardIds.has(id) ? id : resolveBoard(id);
	});
};

/**
 * Actions about the workspace (a person, repo, tag), shown on every board.
 * Not applied to `filterEventsForBoard`: a contributor event is no work on a board.
 */
export const isWorkspaceAction = (action: string): boolean =>
	WORKSPACE_ACTIONS.has(action);

const WORKSPACE_ACTIONS = new Set<string>([
	'create.contributor',
	'rename.contributor',
	'tombstone.contributor',
	'restore.contributor',
	'link.contributor.user',
	'link.contributor.email',
	'unlink.contributor.email',
	'connect.repo',
	'edit.repo',
	'disconnect.repo',
	'create.tag',
	'tombstone.tag',
	'restore.tag',
]);

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
export const buildTimelineEntries = (
	events: AppEvent[],
	// Names old `<id>.<name>.jsonl` file names carry, for actors the log never names.
	fileNames: ReadonlyMap<string, string> = new Map(),
): TimelineEntry[] => {
	// The log's own naming events win over file names.
	const names = new Map([...fileNames, ...projectLogNames(events).byId]);
	const previousParents = buildPreviousParentIndex(events);
	const issueIndex = buildIssueIndex(events);
	const issues = events.map(event => issueOf(event, issueIndex));
	const subjects = subjectsForEvents(events);
	const lanes = lanesForEvents(events, issues);
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
						label: describeTimelineEvent(
							event,
							names,
							previousParents,
							issues[index] ?? null,
							subjects[index] ?? null,
						),
						issue: issues[index] ?? null,
						target: targetOf(event),
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

// One ticket's lane over time, with when it first had a lane and when it was
// closed for good (null while open or reopened).
export type LaneHistory = {
	changes: readonly LaneChange[];
	from: number;
	closedFrom: number | null;
};

// Every ticket's lane over time, for answering where each one sat at any
// moment without walking the entries up to it.
export type LaneIndex = ReadonlyMap<string, LaneHistory>;

export const buildLaneIndex = (
	entries: readonly TimelineEntry[],
): LaneIndex => {
	const changesByIssue = new Map<string, LaneChange[]>();

	for (const entry of entries) {
		if (entry.issue === null || entry.lane === null) continue;

		const changes = changesByIssue.get(entry.issue) ?? [];
		const last = changes[changes.length - 1];

		if (last === undefined || last.lane !== entry.lane) {
			changes.push({t: entry.t, lane: entry.lane, board: entry.board});
			changesByIssue.set(entry.issue, changes);
		}
	}

	const index = new Map<string, LaneHistory>();

	for (const [issue, changes] of changesByIssue) {
		const last = changes[changes.length - 1]!;

		index.set(issue, {
			changes,
			from: changes[0]!.t,
			closedFrom: last.lane === CLOSED_SWIMLANE_ID ? last.t : null,
		});
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

// The lane of every ticket open at a moment, by id, so a window draws tickets
// that sat still; narrowed to a named board by where each ticket was then.
export const lanesOpenAt = (
	index: LaneIndex,
	t: number,
	boardId?: string,
): Record<string, string> => {
	const lanes: Record<string, string> = {};

	for (const [issue, history] of index) {
		// Not yet created, or closed for good by then: a board's worth of old
		// tickets is settled here, without a search each.
		if (history.from >= t) continue;
		if (history.closedFrom !== null && history.closedFrom < t) continue;

		const change = changeBefore(history.changes, t);
		if (change === undefined || change.lane === CLOSED_SWIMLANE_ID) continue;
		if (boardId && change.board !== boardId) continue;

		lanes[issue] = change.lane;
	}

	return lanes;
};

// Every swimlane the log ever created, under its last name, so deleted lanes
// can still be named on a chart.
export const buildLaneNames = (events: AppEvent[]): Record<string, string> =>
	projectLogNames(events).lanes;

export type TimelineIndex = {
	entries: readonly TimelineEntry[];
	lanes: LaneIndex;
	laneNames: Record<string, string>;
};

// One root only, for the life of the process: the GUI server serves one project.
let cache: {root: string; signature: string; index: TimelineIndex} | null =
	null;

// The whole log as timeline entries plus lane index, rebuilt only when the log
// moves. Raw events are dropped; nothing downstream reads them.
export const getTimelineIndex = (
	stateBranchRoot: string,
): Result<TimelineIndex> => {
	// Read before the log, never after: a write landing between is then rebuilt
	// next time rather than cached under a signature it doesn't match.
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

	const entries = buildTimelineEntries(
		eventsResult.value,
		loadActorNames(stateBranchRoot),
	);
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
