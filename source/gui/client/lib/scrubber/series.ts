import {
	GuiEventIdentity,
	GuiEventTimeline,
	GuiEventTimelineEntry,
} from '../gui-state.model';
import {
	BOARD_CONTRIBUTOR_COLOR,
	EVENT_CATEGORY_COLORS,
	GUI_THEME,
} from '../gui-theme';
import {maxOf} from '../../../../lib/utils/minmax.js';

export const EVENT_CATEGORIES = [
	'tickets',
	'comments',
	'tagging',
	'assigning',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

// What the Board series shows: 'all' colours by kind, one kind colours by
// identity, 'contributors' colours every kind by who caused it.
export type BoardView = 'all' | EventCategory | 'contributors';

export const BOARD_VIEWS: BoardView[] = [
	'all',
	...EVENT_CATEGORIES,
	'contributors',
];

export const isBoardView = (value: unknown): value is BoardView =>
	BOARD_VIEWS.includes(value as BoardView);

// The kind a view draws, or null for the two that draw every kind.
const viewCategory = (view: BoardView): EventCategory | null =>
	view === 'all' || view === 'contributors' ? null : view;

// One place for the series colour, so the bars, the baseline and the filter's
// own rows cannot drift apart.
const BOARD_VIEW_COLORS: Record<BoardView, string> = {
	all: GUI_THEME.accent,
	...EVENT_CATEGORY_COLORS,
	contributors: BOARD_CONTRIBUTOR_COLOR,
};

export const boardViewColor = (view: BoardView): string =>
	BOARD_VIEW_COLORS[view];

// What the board can be narrowed by. `commenter` is the author over comments,
// `actor` over every kind.
export const FILTER_AXES = ['commenter', 'tag', 'assignee', 'actor'] as const;

export type FilterAxis = (typeof FILTER_AXES)[number];

export const isFilterAxis = (value: unknown): value is FilterAxis =>
	FILTER_AXES.includes(value as FilterAxis);

// The field on a timeline entry each axis reads its identity out of.
const AXIS_FIELD: Record<FilterAxis, 'actor' | 'tag' | 'assignee'> = {
	commenter: 'actor',
	tag: 'tag',
	assignee: 'assignee',
	actor: 'actor',
};

// The kind of event an axis's legend is drawn from. Null for `actor`, which
// lists whoever caused anything at all.
const AXIS_CATEGORY: Record<FilterAxis, EventCategory | null> = {
	commenter: 'comments',
	tag: 'tagging',
	assignee: 'assigning',
	actor: null,
};

// 'all' asks only that the ticket carry some identity on the axis; a list names which.
export type AxisNarrowing = 'all' | readonly string[];

// A narrowing per axis; an absent axis takes no part, and a ticket must pass every present one.
export type SelectionNarrowing = Partial<Record<FilterAxis, AxisNarrowing>>;

// The ids an axis is narrowed to, or null where it is on with all of them.
export const narrowedIds = (
	narrowing: AxisNarrowing | undefined,
): readonly string[] | null =>
	narrowing === undefined || narrowing === 'all' ? null : narrowing;

// Which axes are asking anything at all, in the order they are listed.
export const activeAxes = (only: SelectionNarrowing): FilterAxis[] =>
	FILTER_AXES.filter(axis => only[axis] !== undefined);

// The view an axis is drawn as, which is the inverse of identityAxisFor.
const VIEW_FOR_AXIS: Record<FilterAxis, BoardView> = {
	commenter: 'comments',
	tag: 'tagging',
	assignee: 'assigning',
	actor: 'contributors',
};

// The view the filter implies: one axis on draws that axis, otherwise 'all'.
export const plottedView = (only: SelectionNarrowing): BoardView => {
	const active = activeAxes(only);
	return active.length === 1 ? VIEW_FOR_AXIS[active[0]!] : 'all';
};

// Which side of the event a view colours by. Tickets has none — every event is
// somebody changing a ticket, so it stays the plain Board accent.
export const identityAxisFor = (view: BoardView): FilterAxis | null =>
	view === 'comments'
		? 'commenter'
		: view === 'tagging'
		? 'tag'
		: view === 'assigning'
		? 'assignee'
		: view === 'contributors'
		? 'actor'
		: null;

// Listed rather than matched on substrings, which misfile near-misses like "attachment".
const CATEGORY_BY_ACTION: Record<string, EventCategory> = {
	'add.issue.comment': 'comments',
	'edit.issue.comment': 'comments',
	'delete.issue.comment': 'comments',
	'add.issue.tag': 'tagging',
	'remove.issue.tag': 'tagging',
	'add.issue.goal': 'tagging',
	'remove.issue.goal': 'tagging',
	'create.goal': 'tagging',
	'rename.goal': 'tagging',
	'edit.goal.description': 'tagging',
	'tombstone.goal': 'tagging',
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
	// Who a commit belongs to, which is the same question assigning answers.
	'link.contributor.email': 'assigning',
	'unlink.contributor.email': 'assigning',
	// Which commits the board reads: a change to the board itself.
	'connect.repo': 'tickets',
	'edit.repo': 'tickets',
	'disconnect.repo': 'tickets',
};

// Everything else is a change to a ticket or to the board holding it.
export const categoryOf = (action: string): EventCategory =>
	CATEGORY_BY_ACTION[action] ?? 'tickets';

// The identity a view colours by, or null where the event has none.
const identityForView = (
	entry: GuiEventTimelineEntry,
	view: BoardView,
): GuiEventIdentity | null => {
	const axis = identityAxisFor(view);
	return axis === null ? null : entry[AXIS_FIELD[axis]];
};

// The identity an event offers an axis, or null where it offers none.
const identityOnAxis = (
	entry: GuiEventTimelineEntry,
	axis: FilterAxis,
): GuiEventIdentity | null => {
	const category = AXIS_CATEGORY[axis];
	if (category !== null && categoryOf(entry.action) !== category) return null;

	return entry[AXIS_FIELD[axis]];
};

// Every identity in the window on this axis, in first-seen order: the filter's legend.
export const listIdentities = (
	timeline: GuiEventTimeline | null,
	axis: FilterAxis | null,
): GuiEventIdentity[] => {
	if (!timeline || axis === null) return [];

	const byId = new Map<string, GuiEventIdentity>();

	for (const entry of timeline.events) {
		const identity = identityOnAxis(entry, axis);
		if (identity && !byId.has(identity.id)) byId.set(identity.id, identity);
	}

	return [...byId.values()];
};

// Every axis's legend in one pass, since it is rebuilt on every board broadcast.
export const listIdentitiesByAxis = (
	timeline: GuiEventTimeline | null,
): Record<FilterAxis, GuiEventIdentity[]> => {
	const byAxis = {} as Record<FilterAxis, Map<string, GuiEventIdentity>>;
	for (const axis of FILTER_AXES) byAxis[axis] = new Map();

	for (const entry of timeline?.events ?? []) {
		for (const axis of FILTER_AXES) {
			const identity = identityOnAxis(entry, axis);
			if (identity && !byAxis[axis].has(identity.id)) {
				byAxis[axis].set(identity.id, identity);
			}
		}
	}

	const lists = {} as Record<FilterAxis, GuiEventIdentity[]>;
	for (const axis of FILTER_AXES) lists[axis] = [...byAxis[axis].values()];

	return lists;
};

// The one identity left visible, whose colour and name the series then takes.
export const soleVisibleIdentity = (
	identities: GuiEventIdentity[],
	hiddenIds: ReadonlySet<string>,
): GuiEventIdentity | null => {
	const visible = identities.filter(identity => !hiddenIds.has(identity.id));
	return visible.length === 1 ? visible[0]! : null;
};

export type EventDot = {
	key: string;
	// null on the bucketed fallback, whose dot stands for a slot.
	id: string | null;
	t: number;
	// Set only on the bucketed fallback.
	count: number | null;
	// The event's own description on a per-event dot, null on the fallback.
	label: string | null;
	// null on the fallback, whose bucket mixes categories.
	category: EventCategory | null;
	// Resolved here, so the renderer needn't know the colour rules.
	color: string;
	// What the dot is coloured by under the current view, for its hint.
	identity: GuiEventIdentity | null;
	size: number;
	opacity: number;
};

// A dot's hover text, with the identity appended unless the label already names it.
export const dotDetail = (dot: EventDot): string => {
	const base =
		dot.label ?? `${dot.count ?? 0} board event${dot.count === 1 ? '' : 's'}`;

	return dot.identity && !base.includes(dot.identity.name)
		? `${base} — ${dot.identity.name}`
		: base;
};

// Fixed, since a per-event dot has no count to encode.
const EVENT_DOT_SIZE = 4;
const EVENT_DOT_OPACITY = 0.55;

// The tickets whose events the chart keeps (null for all): those passing both
// the ticket narrowing and the text query, as the board does.
export const keptIssueIds = (
	issueOnly: string | null,
	queryIssueIds: ReadonlySet<string> | null,
): ReadonlySet<string> | null => {
	if (issueOnly === null) return queryIssueIds;
	if (queryIssueIds === null || queryIssueIds.has(issueOnly)) {
		return new Set([issueOnly]);
	}

	return new Set();
};

// Whether an event is drawn under this view and filter; the log shares this rule.
export const isShown = (
	entry: GuiEventTimelineEntry,
	view: BoardView,
	hiddenIds: ReadonlySet<string>,
	keptIssues: ReadonlySet<string> | null = null,
): boolean => {
	// Narrowing to tickets drops board-level events, which carry no issue.
	if (
		keptIssues !== null &&
		(entry.issue === null || !keptIssues.has(entry.issue))
	) {
		return false;
	}

	const category = viewCategory(view);
	if (category !== null && categoryOf(entry.action) !== category) return false;

	const identity = identityForView(entry, view);

	return identity === null || !hiddenIds.has(identity.id);
};

export const buildEventDots = (
	timeline: GuiEventTimeline | null,
	view: BoardView = 'all',
	hiddenIds: ReadonlySet<string> = new Set(),
	keptIssues: ReadonlySet<string> | null = null,
): EventDot[] => {
	if (!timeline) return [];

	if (timeline.events.length > 0) {
		return timeline.events.flatMap((entry, index) => {
			if (!isShown(entry, view, hiddenIds, keptIssues)) return [];

			const category = categoryOf(entry.action);
			const identity = identityForView(entry, view);

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

// One entry per axis switched on; `visibleIds` null means any identity on it.
export type AxisFilter = {
	axis: FilterAxis;
	visibleIds: ReadonlySet<string> | null;
};

export type BoardFilter = readonly AxisFilter[];

// Independent of the plotted view, so a narrowing outlives the view it was made under.
export const buildBoardFilter = (only: SelectionNarrowing): BoardFilter =>
	activeAxes(only).map(axis => {
		const ids = narrowedIds(only[axis]);
		return {axis, visibleIds: ids === null ? null : new Set(ids)};
	});

// False past the server's cap, where the window holds bucket counts alone.
export const windowNamesIssues = (timeline: GuiEventTimeline | null): boolean =>
	timeline === null ||
	timeline.events.length > 0 ||
	timeline.buckets.length === 0;

// Ticket ids the window holds an event for, or null where it can't say.
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

// Who caused an event on each ticket in the window, or null where it can't say.
export const actorIdsByIssue = (
	timeline: GuiEventTimeline | null,
): Map<string, Set<string>> | null => {
	if (timeline === null || !windowNamesIssues(timeline)) return null;

	const byIssue = new Map<string, Set<string>>();

	for (const entry of timeline.events) {
		if (entry.issue === null || entry.actor === null) continue;

		const ids = byIssue.get(entry.issue) ?? new Set<string>();
		ids.add(entry.actor.id);
		byIssue.set(entry.issue, ids);
	}

	return byIssue;
};

// What a ticket carries that its own row cannot answer for.
export type IssueFilterFacts = {
	// Who has commented on it, read off the board state at the needle.
	commenterIds: readonly string[];
	// Who caused any event on it in the window; null leaves the axis unenforced.
	actorIds: readonly string[] | null;
};

// Tags and assignees are read as of the needle; actors, which only the window
// knows, by the window.
export const issuePassesBoardFilter = (
	issue: {
		id: string;
		tags: {id: string}[];
		assignees: {id: string}[];
	},
	facts: IssueFilterFacts,
	filter: BoardFilter,
): boolean =>
	filter.every(({axis, visibleIds}) => {
		const ids =
			axis === 'tag'
				? issue.tags.map(tag => tag.id)
				: axis === 'assignee'
				? issue.assignees.map(assignee => assignee.id)
				: axis === 'commenter'
				? facts.commenterIds
				: facts.actorIds;

		// Unanswerable, so unenforced.
		if (ids === null) return true;

		// On with every identity: carrying one is the whole question.
		if (visibleIds === null) return ids.length > 0;

		return ids.some(id => visibleIds.has(id));
	});
