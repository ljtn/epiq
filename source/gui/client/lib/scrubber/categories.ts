import {
	GuiEventIdentity,
	GuiEventTimeline,
	GuiEventTimelineEntry,
} from '../gui-state.model';
import {EVENT_CATEGORY_COLORS, GUI_THEME} from '../gui-theme';

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
