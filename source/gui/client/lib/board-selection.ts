import {GuiEventIdentity} from './gui-state.model';
import {
	BoardView,
	isBoardView,
	isLayoutMode,
	isScope,
	LayoutMode,
	PeriodRange,
	Scope,
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
	// Identity ids the view is narrowed to — a positive list rather than the
	// hidden ones, so it says what to show without knowing what else exists.
	// Null when nothing is hidden; [] when everything is.
	only: readonly string[] | null;
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
	only: null,
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
		only: selection.only === null ? null : unique(selection.only),
	};
};

export const isDefaultSelection = (selection: BoardSelection): boolean =>
	selection.scope === DEFAULT_SELECTION.scope &&
	selection.offset === DEFAULT_SELECTION.offset &&
	selection.zoom === null &&
	selection.layout === DEFAULT_SELECTION.layout &&
	selection.view === DEFAULT_SELECTION.view &&
	selection.only === null &&
	selection.windowOnly === DEFAULT_SELECTION.windowOnly &&
	selection.ticketOnly === DEFAULT_SELECTION.ticketOnly;

// A change to one field, with what it implies for the others: a new scope
// starts at its most recent period, and a new view drops a narrowing that
// named the previous view's identities.
export const applySelectionPatch = (
	current: BoardSelection,
	patch: Partial<BoardSelection>,
): BoardSelection => {
	const scopeChanged =
		patch.scope !== undefined && patch.scope !== current.scope;
	const viewChanged = patch.view !== undefined && patch.view !== current.view;

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
		only:
			patch.only !== undefined ? patch.only : viewChanged ? null : current.only,
	});
};

// ------------------------------------------------------------------- the URL

export const hasSelectionParams = (params: URLSearchParams): boolean =>
	PARAM_KEYS.some(key => params.has(key));

// Null when the URL says nothing about the selection. Any one key present
// makes the URL authoritative for all of them, so a link means the same thing
// whoever opens it.
export const readSelectionParams = (
	params: URLSearchParams,
): BoardSelection | null => {
	if (!hasSelectionParams(params)) return null;

	const scope = params.get('scope');
	const layout = params.get('layout');
	const view = params.get('view');
	const only = params.get('only');
	const from = params.get('from');
	const to = params.get('to');

	return normalize({
		scope: isScope(scope) ? scope : DEFAULT_SELECTION.scope,
		offset: Number(params.get('offset') ?? 0),
		zoom:
			from === null || to === null
				? null
				: {start: Number(from), end: Number(to)},
		layout: isLayoutMode(layout) ? layout : DEFAULT_SELECTION.layout,
		view: isBoardView(view) ? view : DEFAULT_SELECTION.view,
		only: only === null ? null : only.split(',').filter(Boolean),
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
	put('only', next.only === null ? null : next.only.join(','));
	put('window', next.windowOnly ? '1' : null);
	put('ticket', next.ticketOnly ? '1' : null);
};

// ------------------------------------------------------------------- storage

// Neither the offset nor a zoom is kept: a stretch of last Tuesday is a
// moment, not a preference, and reopening the board a week later on it would be
// a surprise. Nor is windowOnly: it hides tickets outright, which is too much
// to restore silently days later — it travels in the URL and nowhere else. Nor
// is ticketOnly, which names a ticket that need not even be open next time.
export const readStoredSelection = (): BoardSelection => {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return DEFAULT_SELECTION;

		const parsed: unknown = JSON.parse(stored);
		if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SELECTION;

		const {scope, layout, view, only} = parsed as Record<string, unknown>;

		return normalize({
			scope: isScope(String(scope))
				? (scope as Scope)
				: DEFAULT_SELECTION.scope,
			offset: 0,
			zoom: null,
			layout: isLayoutMode(String(layout))
				? (layout as LayoutMode)
				: DEFAULT_SELECTION.layout,
			view: isBoardView(view) ? view : DEFAULT_SELECTION.view,
			only: Array.isArray(only) ? only.map(String) : null,
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
