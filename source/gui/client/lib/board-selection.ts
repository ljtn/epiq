import {GuiEventIdentity} from './gui-state.model';
import {
	AxisNarrowing,
	BoardView,
	FILTER_AXES,
	FilterAxis,
	identityAxisFor,
	isBoardView,
	isFilterAxis,
	isLayoutMode,
	isScope,
	LayoutMode,
	narrowedIds,
	PeriodRange,
	Scope,
	SelectionNarrowing,
} from './scrubber';

// What the scrubber looks at and narrows the board to. Kept in the query
// string so a view can be shared; localStorage is the fallback.
export type BoardSelection = {
	scope: Scope;
	// Periods back from now; meaningless under 'all' or under a zoom.
	offset: number;
	// A window dragged out on the timeline, standing in for the rolling one
	// scope and offset describe. Null while the scope buttons are in charge.
	zoom: PeriodRange | null;
	layout: LayoutMode;
	// Per axis: absent takes no part, 'all' asks for any value, a list names
	// those that pass. A ticket must pass every axis.
	only: SelectionNarrowing;
	// Narrows the board to the tickets the window holds an event for, rather
	// than to what the selection colours.
	windowOnly: boolean;
	// Narrows the chart to the selected ticket's lifetime and events. Derived
	// rather than written into `zoom`, so turning it off restores the scope.
	ticketOnly: boolean;
	// Narrows the board to one goal's tickets.
	goal: string | null;
};

export const DEFAULT_SELECTION: BoardSelection = {
	scope: 'all',
	offset: 0,
	zoom: null,
	layout: 'even',
	only: {},
	windowOnly: false,
	ticketOnly: false,
	goal: null,
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
	'goal',
] as const;

const STORAGE_KEY = 'epiq.board.selection';

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

// ------------------------------------------------------------- the narrowing

// Whether the board is narrowed at all, on any axis.
export const isNarrowed = (only: SelectionNarrowing): boolean =>
	FILTER_AXES.some(axis => only[axis] !== undefined);

// What one axis is asking, or undefined where it asks nothing — which is also
// what a caller with no axis in hand gets.
export const narrowingFor = (
	only: SelectionNarrowing,
	axis: FilterAxis | null,
): AxisNarrowing | undefined => (axis === null ? undefined : only[axis]);

// Setting one axis. Undefined switches it off, which is also where an empty
// list lands: a row nothing can pass is not a state the checkbox can say.
export const withNarrowing = (
	only: SelectionNarrowing,
	axis: FilterAxis,
	narrowing: AxisNarrowing | undefined,
): SelectionNarrowing => {
	const next = {...only};
	const ids = narrowing === undefined ? [] : narrowedIds(narrowing);

	if (narrowing === undefined || (ids !== null && ids.length === 0)) {
		delete next[axis];
	} else {
		next[axis] = narrowing;
	}

	return next;
};

// The three things a top-level row can say. 'some' is the dash: on, but not
// with everything under it.
export type AxisState = 'off' | 'all' | 'some';

export const axisState = (
	only: SelectionNarrowing,
	axis: FilterAxis,
): AxisState => {
	const narrowing = only[axis];
	if (narrowing === undefined) return 'off';

	return narrowedIds(narrowing) === null ? 'all' : 'some';
};

// Ticking the parent takes the whole axis; unticking it switches the axis off.
export const toggleAxis = (
	only: SelectionNarrowing,
	axis: FilterAxis,
	on: boolean,
): SelectionNarrowing => withNarrowing(only, axis, on ? 'all' : undefined);

// An axis narrowed to nothing is an axis nothing can pass, which is not a
// state any control can say and not one anybody means — it becomes off.
const normalizeNarrowing = (only: SelectionNarrowing): SelectionNarrowing => {
	const next: SelectionNarrowing = {};

	for (const axis of FILTER_AXES) {
		const narrowing = only[axis];
		if (narrowing === undefined) continue;

		const ids = narrowedIds(narrowing);
		if (ids === null) {
			next[axis] = 'all';
		} else if (ids.length > 0) {
			next[axis] = unique(ids);
		}
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
		// A named ticket wins over windowOnly, even from a URL carrying both.
		windowOnly: selection.ticketOnly ? false : selection.windowOnly,
		only: normalizeNarrowing(selection.only),
	};
};

export const isDefaultSelection = (selection: BoardSelection): boolean =>
	selection.scope === DEFAULT_SELECTION.scope &&
	selection.offset === DEFAULT_SELECTION.offset &&
	selection.zoom === null &&
	selection.layout === DEFAULT_SELECTION.layout &&
	!isNarrowed(selection.only) &&
	selection.windowOnly === DEFAULT_SELECTION.windowOnly &&
	selection.ticketOnly === DEFAULT_SELECTION.ticketOnly &&
	selection.goal === DEFAULT_SELECTION.goal;

// A change to one field, with what it implies for the others: a new scope
// starts at its most recent period.
export const applySelectionPatch = (
	current: BoardSelection,
	patch: Partial<BoardSelection>,
): BoardSelection => {
	const scopeChanged =
		patch.scope !== undefined && patch.scope !== current.scope;

	// A scope button clears a zoom, even the one a zoom inferred.
	const zoom =
		patch.zoom !== undefined
			? patch.zoom
			: patch.scope !== undefined
			? null
			: current.zoom;

	// Naming or dragging a scope also leaves the ticket's window.
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

// What a route change must carry that neither the rebuilt query nor storage
// does: opening a ticket rebuilds the query from scratch.
export type CarriedSelection = Pick<
	BoardSelection,
	'offset' | 'zoom' | 'windowOnly' | 'ticketOnly' | 'goal'
>;

// The carried values with the query they were read from. A render between
// writing the values and the URL still reads the old query; the key lets it
// leave the values alone.
export type SelectionCarry = {query: string; values: CarriedSelection};

const carriedFrom = (selection: BoardSelection): CarriedSelection => ({
	offset: selection.offset,
	zoom: selection.zoom,
	windowOnly: selection.windowOnly,
	ticketOnly: selection.ticketOnly,
	goal: selection.goal,
});

export const DEFAULT_CARRY: SelectionCarry = {
	query: '',
	values: carriedFrom(DEFAULT_SELECTION),
};

// Compared as a string: a fresh URLSearchParams for the same query is no news.
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

// Every axis rides in the one `only` key: `only=tag:a,b;assignee:c`.
const AXIS_SEPARATOR = ';';
const NAME_SEPARATOR = ':';

// `*` is the axis on with every identity, as against a list naming a few.
const ALL_IDENTITIES = '*';

const writeNarrowing = (only: SelectionNarrowing): string | null => {
	const groups = FILTER_AXES.flatMap(axis => {
		const narrowing = only[axis];
		if (narrowing === undefined) return [];

		const ids = narrowedIds(narrowing);
		return [
			`${axis}${NAME_SEPARATOR}${
				ids === null ? ALL_IDENTITIES : ids.join(',')
			}`,
		];
	});

	return groups.length === 0 ? null : groups.join(AXIS_SEPARATOR);
};

// A group with no axis prefix is the older one-axis form, read onto the axis
// the URL's view colours by.
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

		const value = at === -1 ? group : group.slice(at + 1);
		only[axis] =
			value === ALL_IDENTITIES ? 'all' : value.split(',').filter(Boolean);
	}

	return only;
};

// Null when the URL says nothing about the selection. Any one key makes the
// URL authoritative for all of them.
export const readSelectionParams = (
	params: URLSearchParams,
): BoardSelection | null => {
	if (!hasSelectionParams(params)) return null;

	const scope = params.get('scope');
	const layout = params.get('layout');
	const from = params.get('from');
	const to = params.get('to');
	// Read but never written, for older links whose unprefixed `only` named no axis.
	const viewParam = params.get('view');
	const legacyView = isBoardView(viewParam) ? viewParam : 'all';

	return normalize({
		scope: isScope(scope) ? scope : DEFAULT_SELECTION.scope,
		offset: Number(params.get('offset') ?? 0),
		zoom:
			from === null || to === null
				? null
				: {start: Number(from), end: Number(to)},
		layout: isLayoutMode(layout) ? layout : DEFAULT_SELECTION.layout,
		only: readNarrowing(params.get('only'), legacyView),
		windowOnly: params.get('window') === '1',
		ticketOnly: params.get('ticket') === '1',
		goal: params.get('goal') || null,
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
	// Never written: what the chart plots is read off `only`.
	put('view', null);
	put('only', writeNarrowing(next.only));
	put('window', next.windowOnly ? '1' : null);
	put('ticket', next.ticketOnly ? '1' : null);
	put('goal', next.goal);
};

// ------------------------------------------------------------------- storage

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
		if (ids === 'all') only[axis] = 'all';
		else if (Array.isArray(ids)) only[axis] = ids.map(String);
	}

	return only;
};

// Not stored: the offset, a zoom, windowOnly, ticketOnly and the goal. They
// are moments or hide tickets, too much to restore silently days later.
export const readStoredSelection = (): BoardSelection => {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return DEFAULT_SELECTION;

		const parsed: unknown = JSON.parse(stored);
		if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SELECTION;

		const {scope, layout, view, only} = parsed as Record<string, unknown>;
		const legacyView = isBoardView(view) ? view : 'all';

		return normalize({
			scope: isScope(String(scope))
				? (scope as Scope)
				: DEFAULT_SELECTION.scope,
			offset: 0,
			zoom: null,
			layout: isLayoutMode(String(layout))
				? (layout as LayoutMode)
				: DEFAULT_SELECTION.layout,
			only: readStoredNarrowing(only, legacyView),
			windowOnly: DEFAULT_SELECTION.windowOnly,
			ticketOnly: DEFAULT_SELECTION.ticketOnly,
			goal: DEFAULT_SELECTION.goal,
		});
	} catch {
		return DEFAULT_SELECTION;
	}
};

export const storeSelection = (selection: BoardSelection): void => {
	try {
		const {scope, layout, only} = selection;
		localStorage.setItem(STORAGE_KEY, JSON.stringify({scope, layout, only}));
	} catch {
		// Storage unavailable: the URL still carries the selection.
	}
};

// ---------------------------------------------------------------- narrowing

// What the legend shows unticked, given what it lists. An axis switched off
// has none of its children ticked; on with everything has all of them.
export const hiddenIdsFor = (
	identities: readonly GuiEventIdentity[],
	narrowing: AxisNarrowing | undefined,
): Set<string> => {
	const listed = identities.map(identity => identity.id);
	if (narrowing === undefined) return new Set(listed);

	const ids = narrowedIds(narrowing);
	if (ids === null) return new Set();

	const shown = new Set(ids);
	return new Set(listed.filter(id => !shown.has(id)));
};

// Back to 'all' once every listed identity is ticked, so one that turns up
// later joins the axis.
export const toggleOnly = (
	narrowing: AxisNarrowing | undefined,
	identities: readonly GuiEventIdentity[],
	id: string,
	shown: boolean,
): AxisNarrowing | undefined => {
	const listed = identities.map(identity => identity.id);
	// An axis switched off has nothing ticked under it, so the first child
	// ticked is the only one — ticking into an off axis switches it on.
	const ids = narrowedIds(narrowing);
	const next = new Set(
		narrowing === undefined ? [] : ids === null ? listed : ids,
	);

	if (shown) {
		next.add(id);
	} else {
		next.delete(id);
	}

	// Every one of them ticked is the axis itself, which is what the parent
	// says; none of them is the axis switched off.
	if (next.size === 0) return undefined;

	return listed.every(listedId => next.has(listedId)) ? 'all' : [...next];
};

// A toggle: isolating the identity already isolated restores the rest.
export const isolateOnly = (
	only: readonly string[] | null,
	id: string,
): readonly string[] | null =>
	only !== null && only.length === 1 && only[0] === id ? null : [id];

// The selection may name identities with no event in view; appended so they
// can still be unticked.
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
