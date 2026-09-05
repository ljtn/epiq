import {
	GuiEventIdentity,
	GuiEventTimeline,
	GuiEventTimelineEntry,
} from '../gui-state.model';
import {EVENT_CATEGORY_COLORS, GUI_THEME} from '../gui-theme';
import {maxOf} from '../../../../lib/utils/minmax.js';

export const EVENT_CATEGORIES = [
	'tickets',
	'comments',
	'tagging',
	'assigning',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

// What the Board series is showing. 'all' draws every kind and colours by kind;
// picking one kind draws only it and colours by the identity behind each event.
// Exactly one at a time, which is what keeps a colour from meaning two things.
export type BoardView = 'all' | EventCategory;

export const BOARD_VIEWS: BoardView[] = ['all', ...EVENT_CATEGORIES];

export const isBoardView = (value: unknown): value is BoardView =>
	BOARD_VIEWS.includes(value as BoardView);

// One place for the series colour, so the bars, the baseline and the filter's
// own rows cannot drift apart.
export const boardViewColor = (view: BoardView): string =>
	view === 'all' ? GUI_THEME.accent : EVENT_CATEGORY_COLORS[view];

// Which side of the event a view colours by. Tickets has none — every event is
// somebody changing a ticket, so it stays the plain Board accent.
export const identityAxisFor = (
	view: BoardView,
): 'actor' | 'tag' | 'assignee' | null =>
	view === 'comments'
		? 'actor'
		: view === 'tagging'
		? 'tag'
		: view === 'assigning'
		? 'assignee'
		: null;

// Listed rather than matched on substrings: "attachment" and "assignee" both
// read as near-misses for the tag and comment rules, and a wrong bucket here is
// invisible until someone counts.
const CATEGORY_BY_ACTION: Record<string, EventCategory> = {
	'add.issue.comment': 'comments',
	'edit.issue.comment': 'comments',
	'delete.issue.comment': 'comments',
	'add.issue.tag': 'tagging',
	'remove.issue.tag': 'tagging',
	'create.tag': 'tagging',
	'tombstone.tag': 'tagging',
	'restore.tag': 'tagging',
	'add.issue.assignee': 'assigning',
	'remove.issue.assignee': 'assigning',
	'create.contributor': 'assigning',
	'rename.contributor': 'assigning',
	'tombstone.contributor': 'assigning',
	'restore.contributor': 'assigning',
	'link.contributor.user': 'assigning',
};

// Everything else is a change to a ticket or to the board holding it.
export const categoryOf = (action: string): EventCategory =>
	CATEGORY_BY_ACTION[action] ?? 'tickets';

// The identity a view colours by, or null where the event has none — an
// assigning view over a `create.contributor`, say.
export const identityOf = (
	entry: GuiEventTimelineEntry,
	view: BoardView,
): GuiEventIdentity | null => {
	const axis = identityAxisFor(view);
	return axis === null ? null : entry[axis];
};

// Every identity present in the window under this view, in first-seen order.
// Doubles as the filter's legend, so it lists what is actually there rather
// than every tag or contributor the repo has ever had.
export const listIdentities = (
	timeline: GuiEventTimeline | null,
	view: BoardView,
): GuiEventIdentity[] => {
	if (!timeline || identityAxisFor(view) === null) return [];

	const byId = new Map<string, GuiEventIdentity>();

	for (const entry of timeline.events) {
		if (categoryOf(entry.action) !== view) continue;

		const identity = identityOf(entry, view);
		if (identity && !byId.has(identity.id)) byId.set(identity.id, identity);
	}

	return [...byId.values()];
};

// The one identity left when everything else in the view is hidden — reached by
// unchecking down to one, or in a click via "only". Narrowed that far the series
// no longer stands for a kind, it stands for that tag or person, so the bars and
// the label take its colour and its name rather than the kind's.
export const soleVisibleIdentity = (
	identities: GuiEventIdentity[],
	hiddenIds: ReadonlySet<string>,
): GuiEventIdentity | null => {
	const visible = identities.filter(identity => !hiddenIds.has(identity.id));
	return visible.length === 1 ? visible[0]! : null;
};

export type EventDot = {
	key: string;
	// The event this dot stands for. null on the bucketed fallback, whose dot
	// stands for a slot rather than one event.
	id: string | null;
	t: number;
	// null on a per-event dot, where the dot *is* the event. Set only on the
	// bucketed fallback, whose dot stands for a slot that may hold several.
	count: number | null;
	// The event's own description on a per-event dot, null on the fallback.
	label: string | null;
	// null on the fallback, whose bucket mixes categories with no way to tell
	// them apart. Drawn in the plain Board accent there.
	category: EventCategory | null;
	// Resolved here rather than by the renderer, which would otherwise need to
	// know which of the three colour rules applies.
	color: string;
	// What the dot is coloured by under the current view, for its hint.
	identity: GuiEventIdentity | null;
	size: number;
	opacity: number;
};

// What a dot says when hovered. The identity is appended only where the label
// does not already carry it: "Tagged with bug" names its tag, "Commented" does
// not name its author.
export const dotDetail = (dot: EventDot): string => {
	const base =
		dot.label ?? `${dot.count ?? 0} board event${dot.count === 1 ? '' : 's'}`;

	return dot.identity && !base.includes(dot.identity.name)
		? `${base} — ${dot.identity.name}`
		: base;
};

// Fixed, because a per-event dot has no count to encode. Matches the commit
// scatter, which has always been one dot per commit.
const EVENT_DOT_SIZE = 4;
const EVENT_DOT_OPACITY = 0.55;

// The scatter plots each dot at its own timestamp, so it wants events, not
// buckets. Buckets are the fallback for a window the server capped, and only
// there do size and opacity carry a count.
// An event is drawn when its kind matches the view and the identity it would be
// coloured by has not been unticked. An event with no identity under this view
// always shows: there is nothing in the list for the user to have hidden it by.
// The rule the chart draws by, exported so the log can draw by the same one
// rather than growing a second copy to drift from it.
export const isShown = (
	entry: GuiEventTimelineEntry,
	view: BoardView,
	hiddenIds: ReadonlySet<string>,
	issueOnly: string | null = null,
): boolean => {
	// Board- and swimlane-level events carry no issue, so narrowing to one
	// ticket drops them too: they are not what happened to it.
	if (issueOnly !== null && entry.issue !== issueOnly) return false;

	if (view !== 'all' && categoryOf(entry.action) !== view) return false;

	const identity = identityOf(entry, view);

	return identity === null || !hiddenIds.has(identity.id);
};

export const buildEventDots = (
	timeline: GuiEventTimeline | null,
	view: BoardView = 'all',
	hiddenIds: ReadonlySet<string> = new Set(),
	issueOnly: string | null = null,
): EventDot[] => {
	if (!timeline) return [];

	if (timeline.events.length > 0) {
		return timeline.events.flatMap((entry, index) => {
			if (!isShown(entry, view, hiddenIds, issueOnly)) return [];

			const category = categoryOf(entry.action);
			const identity = identityOf(entry, view);

			return [
				{
					// Two events can share a millisecond, so time alone is not a key.
					key: `${entry.t}-${index}`,
					id: entry.id,
					t: entry.t,
					count: null,
					label: entry.label,
					category,
					color:
						view === 'all'
							? EVENT_CATEGORY_COLORS[category]
							: identity?.color ?? GUI_THEME.accent,
					identity,
					size: EVENT_DOT_SIZE,
					opacity: EVENT_DOT_OPACITY,
				},
			];
		});
	}

	const maxCount = maxOf(
		timeline.buckets.map(bucket => bucket.count),
		1,
	);

	return timeline.buckets.map(bucket => {
		const intensity = bucket.count / maxCount;

		return {
			key: String(bucket.t),
			id: null,
			t: bucket.t,
			count: bucket.count,
			label: null,
			category: null,
			color: GUI_THEME.accent,
			identity: null,
			size: 3 + intensity * 6,
			opacity: 0.3 + intensity * 0.5,
		};
	});
};

// What the scrubber's selection means for the board below it. Null when the
// selection narrows nothing, so the board is left alone.
export type BoardFilter = {
	axis: 'actor' | 'tag' | 'assignee';
	visibleIds: ReadonlySet<string>;
};

// Only a narrowed selection filters the board. A kind with everything still
// ticked is a colouring choice, not a question about which tickets matter.
export const buildBoardFilter = (
	view: BoardView,
	only: readonly string[] | null,
): BoardFilter | null => {
	const axis = identityAxisFor(view);
	if (axis === null || only === null) return null;

	return {axis, visibleIds: new Set(only)};
};

// Whether the window says which tickets its events belong to. Past the
// server's cap it answers with bucket counts alone, which name none — as
// against a quiet window, which names none because nothing happened.
export const windowNamesIssues = (timeline: GuiEventTimeline | null): boolean =>
	timeline === null ||
	timeline.events.length > 0 ||
	timeline.buckets.length === 0;

// Ticket ids the window holds an event for, which is what the window filter
// narrows the board to. Null where the board cannot be narrowed at all: before
// a timeline has arrived, and where the window names no tickets it counted.
export const windowIssueIds = (
	timeline: GuiEventTimeline | null,
): Set<string> | null => {
	if (timeline === null || !windowNamesIssues(timeline)) return null;

	const ids = new Set<string>();

	for (const entry of timeline.events) {
		if (entry.issue !== null) ids.add(entry.issue);
	}

	return ids;
};

// Read off the board's own state, which is already the state at the needle —
// so a filtered board answers "who/what, as of here", matching the moment the
// scrubber is parked on rather than the events inside the window.
export const issuePassesBoardFilter = (
	issue: {
		id: string;
		tags: {id: string}[];
		assignees: {id: string}[];
	},
	commentAuthorIds: readonly string[],
	filter: BoardFilter | null,
): boolean => {
	if (!filter) return true;

	const ids =
		filter.axis === 'tag'
			? issue.tags.map(tag => tag.id)
			: filter.axis === 'assignee'
			? issue.assignees.map(assignee => assignee.id)
			: commentAuthorIds;

	return ids.some(id => filter.visibleIds.has(id));
};
