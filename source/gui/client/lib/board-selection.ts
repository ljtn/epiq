import {GuiEventIdentity} from './gui-state.model';
import {
	BoardView,
	FILTER_AXES,
	FilterAxis,
	identityAxisFor,
	isBoardView,
	isFilterAxis,
	isLayoutMode,
	isScope,
	LayoutMode,
	PeriodRange,
	Scope,
	SelectionNarrowing,
} from './scrubber';

// What the scrubber is looking at, and what that narrows the board to. Kept
// in the query string so a view can be handed to someone else, with
// localStorage as the fallback for a bare board link.
export type BoardSelection = {
	scope: Scope;
	// Periods back from now; meaningless under 'all' or under a zoom.
	offset: number;
	// A window dragged out on the timeline, standing in for the rolling one
	// scope and offset describe. Null while the scope buttons are in charge.
	zoom: PeriodRange | null;
	layout: LayoutMode;
	view: BoardView;
	// Identity ids the board is narrowed to, per axis — a positive list rather
	// than the hidden ones, so it says what to show without knowing what else
	// exists. An axis absent is not narrowed; [] hides everything on it. Axes
	// hold at once and a ticket has to pass them all, so "assigned to her" and
	// "tagged bug" is one question rather than two that overwrite each other.
	only: SelectionNarrowing;
	// Narrows the board to the tickets the window holds an event for, rather
	// than to what the selection colours.
	windowOnly: boolean;
	// Narrows the chart to the selected ticket: the window becomes the stretch
	// that ticket has existed for, and every event belonging to another goes.
	// The window is derived while this is on rather than written into `zoom`,
	// so turning it off hands the scope buttons back what they had.
	ticketOnly: boolean;
};

export const DEFAULT_SELECTION: BoardSelection = {
	scope: 'all',
	offset: 0,
	zoom: null,
	layout: 'even',
	view: 'all',
	only: {},
	windowOnly: false,
	ticketOnly: false,
};

const PARAM_KEYS = [
	'scope',
	'offset',
	'from',
	'to',
	'layout',
	'view',
	'only',
	'window',
	'ticket',
] as const;

const STORAGE_KEY = 'epiq.board.selection';

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

// ------------------------------------------------------------- the narrowing

// Whether the board is narrowed at all, on any axis.
export const isNarrowed = (only: SelectionNarrowing): boolean =>
	FILTER_AXES.some(axis => only[axis] !== undefined);

// One axis's list, or null where that axis is not narrowed — the shape every
// legend helper below takes, and what a caller with no axis in hand gets.
export const narrowingFor = (
	only: SelectionNarrowing,
	axis: FilterAxis | null,
): readonly string[] | null => (axis === null ? null : only[axis] ?? null);

// Setting one axis's list. Null removes the axis rather than storing an empty
// one: [] already means "everything on this axis is hidden".
export const withNarrowing = (
	only: SelectionNarrowing,
	axis: FilterAxis,
	ids: readonly string[] | null,
): SelectionNarrowing => {
	const next = {...only};

	if (ids === null) {
		delete next[axis];
	} else {
		next[axis] = ids;
	}

	return next;
};

const normalizeNarrowing = (only: SelectionNarrowing): SelectionNarrowing => {
	const next: SelectionNarrowing = {};

	for (const axis of FILTER_AXES) {
		const ids = only[axis];
		if (ids !== undefined) next[axis] = unique(ids);
	}

	return next;
};

// A window has to be two real moments in order, or the axis it builds spans
// NaN and every fraction on the chart goes with it.
const validZoom = (zoom: PeriodRange | null): PeriodRange | null =>
	zoom !== null &&
	Number.isFinite(zoom.start) &&
	Number.isFinite(zoom.end) &&
	zoom.end > zoom.start
		? zoom
		: null;

const normalize = (selection: BoardSelection): BoardSelection => {
	const zoom = validZoom(selection.zoom);

	return {
		...selection,
		zoom,
		// A zoom is the window, so there is no period left to page by count.
		offset:
			zoom !== null ||
			selection.scope === 'all' ||
			!Number.isInteger(selection.offset) ||
			selection.offset < 0
				? 0
				: selection.offset,
		// One named ticket is a narrower ask than every ticket a window happens
		// to touch, so the two never hold at once — the ticket wins, and its box
		// is the only one lit. Enforced here rather than at the patch, so a URL
		// carrying both cannot put the board in a state the controls cannot say.
		windowOnly: selection.ticketOnly ? false : selection.windowOnly,
		only: normalizeNarrowing(selection.only),
	};
};

export const isDefaultSelection = (selection: BoardSelection): boolean =>
	selection.scope === DEFAULT_SELECTION.scope &&
	selection.offset === DEFAULT_SELECTION.offset &&
	selection.zoom === null &&
	selection.layout === DEFAULT_SELECTION.layout &&
	selection.view === DEFAULT_SELECTION.view &&
	!isNarrowed(selection.only) &&
	selection.windowOnly === DEFAULT_SELECTION.windowOnly &&
	selection.ticketOnly === DEFAULT_SELECTION.ticketOnly;

// A change to one field, with what it implies for the others: a new scope
// starts at its most recent period. A new view implies nothing for the
// narrowing any more — every axis keeps its own list, so switching what the
// chart plots no longer throws away what the board was narrowed to.
export const applySelectionPatch = (
	current: BoardSelection,
	patch: Partial<BoardSelection>,
): BoardSelection => {
	const scopeChanged =
		patch.scope !== undefined && patch.scope !== current.scope;

	// Reaching for a scope button is how you get back out of a zoom, so it
	// clears one even when the scope named is the one a zoom inferred — which is
	// the button that looks pressed while zoomed.
	const zoom =
		patch.zoom !== undefined
			? patch.zoom
			: patch.scope !== undefined
			? null
			: current.zoom;

	// The ticket's own window stands in front of both of those, so naming a
	// scope or dragging one out is how you leave it, the same way naming a
	// scope is how you leave a zoom.
	const ticketOnly =
		patch.ticketOnly !== undefined
			? patch.ticketOnly
			: patch.scope !== undefined || patch.zoom !== undefined
			? false
			: current.ticketOnly;

	return normalize({
		...current,
		...patch,
		zoom,
		ticketOnly,
		offset: scopeChanged ? 0 : patch.offset ?? current.offset,
	});
};

// ---------------------------------------------------------------- carrying

// What a route change carries that neither the rebuilt query nor storage does:
// opening a ticket rebuilds the query from scratch, and none of a board
// narrowed to a window, a stretch dragged out of the chart, or a window paged
// back off the present must come undone under the reader who clicked one of
// the cards it left showing.
export type CarriedSelection = Pick<
	BoardSelection,
	'offset' | 'zoom' | 'windowOnly' | 'ticketOnly'
>;

// The carried values together with the query they were read out of. The query
// is what makes a change survive: writing one is two steps — the values here,
// then the URL a render later — and any re-render in between still reads the
// pre-change query. Keyed, such a render is recognised as having nothing newer
// to say and leaves the values alone; unkeyed it reads the switched-off
// narrowing back over them, and a bare query then puts it straight back on.
export type SelectionCarry = {query: string; values: CarriedSelection};

const carriedFrom = (selection: BoardSelection): CarriedSelection => ({
	offset: selection.offset,
	zoom: selection.zoom,
	windowOnly: selection.windowOnly,
	ticketOnly: selection.ticketOnly,
});

export const DEFAULT_CARRY: SelectionCarry = {
	query: '',
	values: carriedFrom(DEFAULT_SELECTION),
};

// A render offering the selection it derived. The query is compared as a
// string rather than by identity, since a fresh URLSearchParams for the same
// query says nothing new either.
export const carryRender = (
	carry: SelectionCarry,
	query: string,
	selection: BoardSelection,
): SelectionCarry =>
	carry.query === query ? carry : {query, values: carriedFrom(selection)};

// A change, ahead of the URL it is about to write. The query stays the one
// these values now supersede, so the renders still holding it are skipped.
export const carryChange = (
	carry: SelectionCarry,
	next: BoardSelection,
): SelectionCarry => ({query: carry.query, values: carriedFrom(next)});

// ------------------------------------------------------------------- the URL

export const hasSelectionParams = (params: URLSearchParams): boolean =>
	PARAM_KEYS.some(key => params.has(key));

// The narrowing rides in the one `only` key rather than a key per axis, which
// would put four more names in the query's way for the sake of a shape nobody
// types by hand: `only=tag:a,b;assignee:c`.
const AXIS_SEPARATOR = ';';
const NAME_SEPARATOR = ':';

const writeNarrowing = (only: SelectionNarrowing): string | null => {
	const groups = FILTER_AXES.flatMap(axis => {
		const ids = only[axis];
		return ids === undefined
			? []
			: [`${axis}${NAME_SEPARATOR}${ids.join(',')}`];
	});

	return groups.length === 0 ? null : groups.join(AXIS_SEPARATOR);
};

// A group with no axis in front of it is the one-axis form links were written
// in before: it named no axis because the view was the axis, so it is read onto
// whichever axis the view in the same URL colours by.
const readNarrowing = (
	value: string | null,
	view: BoardView,
): SelectionNarrowing => {
	if (value === null) return {};

	const only: SelectionNarrowing = {};

	for (const group of value.split(AXIS_SEPARATOR)) {
		if (group === '') continue;

		const at = group.indexOf(NAME_SEPARATOR);
		const axis = at === -1 ? identityAxisFor(view) : group.slice(0, at);
		if (axis === null || !isFilterAxis(axis)) continue;

		only[axis] = (at === -1 ? group : group.slice(at + 1))
			.split(',')
			.filter(Boolean);
	}

	return only;
};

// Null when the URL says nothing about the selection. Any one key present
// makes the URL authoritative for all of them, so a link means the same thing
// whoever opens it.
export const readSelectionParams = (
	params: URLSearchParams,
): BoardSelection | null => {
	if (!hasSelectionParams(params)) return null;

	const scope = params.get('scope');
	const layout = params.get('layout');
	const viewParam = params.get('view');
	const from = params.get('from');
	const to = params.get('to');
	const view = isBoardView(viewParam) ? viewParam : DEFAULT_SELECTION.view;

	return normalize({
		scope: isScope(scope) ? scope : DEFAULT_SELECTION.scope,
		offset: Number(params.get('offset') ?? 0),
		zoom:
			from === null || to === null
				? null
				: {start: Number(from), end: Number(to)},
		layout: isLayoutMode(layout) ? layout : DEFAULT_SELECTION.layout,
		view,
		only: readNarrowing(params.get('only'), view),
		windowOnly: params.get('window') === '1',
		ticketOnly: params.get('ticket') === '1',
	});
};

// Defaults are left off, so a URL only carries what somebody chose.
export const writeSelectionParams = (
	params: URLSearchParams,
	selection: BoardSelection,
): void => {
	const put = (key: (typeof PARAM_KEYS)[number], value: string | null) => {
		if (value === null) {
			params.delete(key);
		} else {
			params.set(key, value);
		}
	};

	const next = normalize(selection);

	put('scope', next.scope === DEFAULT_SELECTION.scope ? null : next.scope);
	put('offset', next.offset === 0 ? null : String(next.offset));
	put('from', next.zoom === null ? null : String(next.zoom.start));
	put('to', next.zoom === null ? null : String(next.zoom.end));
	put('layout', next.layout === DEFAULT_SELECTION.layout ? null : next.layout);
	put('view', next.view === DEFAULT_SELECTION.view ? null : next.view);
	put('only', writeNarrowing(next.only));
	put('window', next.windowOnly ? '1' : null);
	put('ticket', next.ticketOnly ? '1' : null);
};

// ------------------------------------------------------------------- storage

// Neither the offset nor a zoom is kept: a stretch of last Tuesday is a
// moment, not a preference, and reopening the board a week later on it would be
// a surprise. Nor is windowOnly: it hides tickets outright, which is too much
// to restore silently days later — it travels in the URL and nowhere else. Nor
// is ticketOnly, which names a ticket that need not even be open next time.
// A bare array is what was stored before the narrowing had axes; like the URL's
// unprefixed list it belonged to whichever axis the stored view colours by.
const readStoredNarrowing = (
	value: unknown,
	view: BoardView,
): SelectionNarrowing => {
	if (Array.isArray(value)) {
		const axis = identityAxisFor(view);
		return axis === null ? {} : {[axis]: value.map(String)};
	}

	if (typeof value !== 'object' || value === null) return {};

	const stored = value as Record<string, unknown>;
	const only: SelectionNarrowing = {};

	for (const axis of FILTER_AXES) {
		const ids = stored[axis];
		if (Array.isArray(ids)) only[axis] = ids.map(String);
	}

	return only;
};

export const readStoredSelection = (): BoardSelection => {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return DEFAULT_SELECTION;

		const parsed: unknown = JSON.parse(stored);
		if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SELECTION;

		const {scope, layout, view, only} = parsed as Record<string, unknown>;
		const boardView = isBoardView(view) ? view : DEFAULT_SELECTION.view;

		return normalize({
			scope: isScope(String(scope))
				? (scope as Scope)
				: DEFAULT_SELECTION.scope,
			offset: 0,
			zoom: null,
			layout: isLayoutMode(String(layout))
				? (layout as LayoutMode)
				: DEFAULT_SELECTION.layout,
			view: boardView,
			only: readStoredNarrowing(only, boardView),
			windowOnly: DEFAULT_SELECTION.windowOnly,
			ticketOnly: DEFAULT_SELECTION.ticketOnly,
		});
	} catch {
		return DEFAULT_SELECTION;
	}
};

export const storeSelection = (selection: BoardSelection): void => {
	try {
		const {scope, layout, view, only} = selection;
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({scope, layout, view, only}),
		);
	} catch {
		// Storage unavailable: the URL still carries the selection.
	}
};

// ---------------------------------------------------------------- narrowing

// What the legend shows unticked, given what it lists.
export const hiddenIdsFor = (
	identities: readonly GuiEventIdentity[],
	only: readonly string[] | null,
): Set<string> => {
	if (only === null) return new Set();

	const shown = new Set(only);
	return new Set(
		identities.map(identity => identity.id).filter(id => !shown.has(id)),
	);
};

// Ticking or unticking one identity. Back to null once every listed identity
// is ticked, so a tag or person that turns up later is shown rather than
// missing from a list nobody meant to close.
export const toggleOnly = (
	only: readonly string[] | null,
	identities: readonly GuiEventIdentity[],
	id: string,
	shown: boolean,
): readonly string[] | null => {
	const listed = identities.map(identity => identity.id);
	const next = new Set(only ?? listed);

	if (shown) {
		next.add(id);
	} else {
		next.delete(id);
	}

	return listed.every(listedId => next.has(listedId)) ? null : [...next];
};

// A toggle: isolating the identity already isolated restores the rest.
export const isolateOnly = (
	only: readonly string[] | null,
	id: string,
): readonly string[] | null =>
	only !== null && only.length === 1 && only[0] === id ? null : [id];

// The legend lists what the window holds, which need not include what the
// selection names — a tag isolated from a card, or arriving by link, may have
// no event in view. Appended from what the board knows, so it can be unticked.
export const withSelectedIdentities = (
	listed: readonly GuiEventIdentity[],
	only: readonly string[] | null,
	known: readonly GuiEventIdentity[],
): GuiEventIdentity[] => {
	if (only === null) return [...listed];

	const present = new Set(listed.map(identity => identity.id));
	const extra = only
		.filter(id => !present.has(id))
		.map(id => known.find(identity => identity.id === id))
		.filter((identity): identity is GuiEventIdentity => Boolean(identity));

	return extra.length === 0 ? [...listed] : [...listed, ...extra];
};
