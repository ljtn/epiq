import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {GuiEventIdentity} from './gui-state.model';
import {
	applySelectionPatch,
	BoardSelection,
	carryChange,
	carryRender,
	DEFAULT_CARRY,
	DEFAULT_SELECTION,
	hasSelectionParams,
	hiddenIdsFor,
	isDefaultSelection,
	isolateOnly,
	readSelectionParams,
	readStoredSelection,
	SelectionCarry,
	storeSelection,
	toggleOnly,
	withNarrowing,
	withSelectedIdentities,
	writeSelectionParams,
} from './board-selection';

const identity = (id: string): GuiEventIdentity => ({
	id,
	name: id,
	color: '#fff',
});

const bug = identity('bug');
const docs = identity('docs');
const gui = identity('gui');

const params = (query: string) => new URLSearchParams(query);

const written = (selection: BoardSelection, from = ''): string => {
	const next = params(from);
	writeSelectionParams(next, selection);
	return next.toString();
};

describe('selection in the URL', () => {
	it('is absent from a bare URL, and from one carrying only other params', () => {
		expect(readSelectionParams(params(''))).toBeNull();
		expect(readSelectionParams(params('tab=comments'))).toBeNull();
		expect(hasSelectionParams(params('tab=comments'))).toBe(false);
	});

	it('treats any one key as the whole selection, defaults for the rest', () => {
		expect(readSelectionParams(params('scope=week'))).toEqual({
			...DEFAULT_SELECTION,
			scope: 'week',
		});
	});

	it('round-trips every field', () => {
		const selection: BoardSelection = {
			scope: 'month',
			offset: 2,
			zoom: null,
			layout: 'real',
			view: 'tagging',
			only: {tag: ['bug', 'docs'], assignee: ['jola']},
			windowOnly: true,
			ticketOnly: false,
		};

		expect(readSelectionParams(params(written(selection)))).toEqual(selection);
	});

	it('names the axis of every list it writes', () => {
		expect(
			written({
				...DEFAULT_SELECTION,
				only: {tag: ['bug'], assignee: ['jola']},
			}),
		).toBe('only=tag%3Abug%3Bassignee%3Ajola');
	});

	// The one-axis form, from before each axis carried its own list: it named
	// no axis because the view was the axis.
	it('reads an unprefixed list onto the axis the view colours by', () => {
		expect(
			readSelectionParams(params('view=tagging&only=bug,docs'))?.only,
		).toEqual({tag: ['bug', 'docs']});
		expect(
			readSelectionParams(params('view=comments&only=jola'))?.only,
		).toEqual({commenter: ['jola']});
		// No axis to put it on, so there is nothing to read it as.
		expect(readSelectionParams(params('view=all&only=bug'))?.only).toEqual({});
	});

	it('writes nothing for the defaults, and clears what was there', () => {
		expect(written(DEFAULT_SELECTION)).toBe('');
		expect(written(DEFAULT_SELECTION, 'scope=week&only=bug&view=tagging')).toBe(
			'',
		);
	});

	it('leaves params that are not its own alone', () => {
		expect(written({...DEFAULT_SELECTION, scope: 'day'}, 'tab=code')).toBe(
			'tab=code&scope=day',
		);
	});

	it('tells an empty narrowing from none', () => {
		expect(written({...DEFAULT_SELECTION, only: {tag: []}})).toBe(
			'only=tag%3A',
		);
		expect(readSelectionParams(params('only=tag%3A'))?.only).toEqual({tag: []});
		expect(readSelectionParams(params('view=tagging'))?.only).toEqual({});
	});

	it('falls back per field on values it does not recognise', () => {
		expect(
			readSelectionParams(
				params('scope=fortnight&offset=x&layout=3d&view=nope&only=nope%3Abug'),
			),
		).toEqual(DEFAULT_SELECTION);
	});

	it('has no offset under all time, and none negative', () => {
		expect(readSelectionParams(params('scope=all&offset=3'))?.offset).toBe(0);
		expect(readSelectionParams(params('scope=week&offset=-1'))?.offset).toBe(0);
		expect(readSelectionParams(params('scope=week&offset=1.5'))?.offset).toBe(
			0,
		);
	});

	it('drops duplicate ids', () => {
		expect(
			readSelectionParams(params('only=tag%3Abug,bug,docs'))?.only,
		).toEqual({tag: ['bug', 'docs']});
	});
});

describe('applySelectionPatch', () => {
	const narrowed: BoardSelection = {
		scope: 'week',
		offset: 3,
		zoom: null,
		layout: 'even',
		view: 'tagging',
		only: {tag: ['bug']},
		windowOnly: false,
		ticketOnly: false,
	};

	it('starts a new scope at its most recent period', () => {
		expect(applySelectionPatch(narrowed, {scope: 'day'}).offset).toBe(0);
		expect(applySelectionPatch(narrowed, {scope: 'week'}).offset).toBe(3);
	});

	// Each axis keeps its own list, so there is nothing belonging to the old
	// view left to throw away.
	it('keeps the narrowing when the view changes', () => {
		expect(applySelectionPatch(narrowed, {view: 'assigning'}).only).toEqual({
			tag: ['bug'],
		});
	});

	it('lets a patch set the view and the narrowing together', () => {
		expect(
			applySelectionPatch(DEFAULT_SELECTION, {
				view: 'tagging',
				only: {tag: ['gui']},
			}),
		).toEqual({...DEFAULT_SELECTION, view: 'tagging', only: {tag: ['gui']}});
	});

	it('narrows several axes at once, each on its own', () => {
		const both = applySelectionPatch(narrowed, {
			only: withNarrowing(narrowed.only, 'assignee', ['jola']),
		});

		expect(both.only).toEqual({tag: ['bug'], assignee: ['jola']});
		expect(
			applySelectionPatch(both, {
				only: withNarrowing(both.only, 'tag', null),
			}).only,
		).toEqual({assignee: ['jola']});
	});

	it('is the default once everything is put back', () => {
		expect(
			isDefaultSelection(
				applySelectionPatch(narrowed, {scope: 'all', view: 'all', only: {}}),
			),
		).toBe(true);
		expect(isDefaultSelection(narrowed)).toBe(false);
	});

	describe('zoom', () => {
		const zoomed = applySelectionPatch(narrowed, {
			zoom: {start: 1000, end: 5000},
		});

		it('leaves the offset behind, since a zoom is the window itself', () => {
			expect(zoomed.zoom).toEqual({start: 1000, end: 5000});
			expect(zoomed.offset).toBe(0);
		});

		// While zoomed no scope button reads as pressed, so every one of them is
		// a way out — the one already held included.
		it('is cleared by naming any scope, the one already held included', () => {
			expect(applySelectionPatch(zoomed, {scope: 'day'}).zoom).toBeNull();
			expect(applySelectionPatch(zoomed, {scope: 'week'}).zoom).toBeNull();
			expect(zoomed.scope).toBe('week');
		});

		it('survives a patch that says nothing about it', () => {
			expect(applySelectionPatch(zoomed, {layout: 'real'}).zoom).toEqual({
				start: 1000,
				end: 5000,
			});
		});

		it('refuses a window that is not two moments in order', () => {
			for (const zoom of [
				{start: 5000, end: 1000},
				{start: 1000, end: 1000},
				{start: Number.NaN, end: 5000},
			]) {
				expect(applySelectionPatch(narrowed, {zoom}).zoom).toBeNull();
			}
		});

		it('round-trips through the URL', () => {
			expect(readSelectionParams(params(written(zoomed)))).toEqual(zoomed);
		});

		it('needs both bounds in the URL to mean anything', () => {
			expect(readSelectionParams(params('from=1000'))?.zoom).toBeNull();
			expect(readSelectionParams(params('to=5000'))?.zoom).toBeNull();
		});
	});

	describe('the ticket window', () => {
		const focused = applySelectionPatch(narrowed, {ticketOnly: true});

		// It stands in front of both the rolling period and a dragged-out
		// window, so reaching for either is how you leave it.
		it('is cleared by naming a scope', () => {
			expect(applySelectionPatch(focused, {scope: 'day'}).ticketOnly).toBe(
				false,
			);
			expect(applySelectionPatch(focused, {scope: 'week'}).ticketOnly).toBe(
				false,
			);
		});

		it('is cleared by dragging a window out', () => {
			expect(
				applySelectionPatch(focused, {zoom: {start: 1000, end: 5000}})
					.ticketOnly,
			).toBe(false);
		});

		it('survives a patch that says nothing about it', () => {
			expect(applySelectionPatch(focused, {layout: 'real'}).ticketOnly).toBe(
				true,
			);
		});

		// The ticket's own stretch replaces the window, so it never writes one
		// into the selection — unticking hands back whatever was there.
		it('leaves the scope and zoom it was turned on over untouched', () => {
			expect(focused.scope).toBe('week');
			expect(focused.zoom).toBeNull();
			expect(applySelectionPatch(focused, {ticketOnly: false}).scope).toBe(
				'week',
			);
		});

		it('round-trips through the URL', () => {
			expect(readSelectionParams(params(written(focused)))).toEqual(focused);
			expect(readSelectionParams(params('ticket=1'))?.ticketOnly).toBe(true);
		});

		// One named ticket is the narrower ask, so the window filter goes with
		// it rather than leaving a second box lit that decides nothing.
		it('takes the window filter with it', () => {
			const scoped = applySelectionPatch(narrowed, {windowOnly: true});
			expect(scoped.windowOnly).toBe(true);

			const both = applySelectionPatch(scoped, {ticketOnly: true});
			expect(both.ticketOnly).toBe(true);
			expect(both.windowOnly).toBe(false);
		});

		it('cannot be made to hold both, even by hand in the URL', () => {
			const read = readSelectionParams(params('scope=week&window=1&ticket=1'));

			expect(read?.ticketOnly).toBe(true);
			expect(read?.windowOnly).toBe(false);
		});
	});
});

describe('stored selection', () => {
	// No DOM under vitest here: the store only needs get/set/clear.
	beforeAll(() => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => store.set(key, value),
			clear: () => store.clear(),
		});
	});

	beforeEach(() => {
		localStorage.clear();
	});

	it('is the default when nothing is stored', () => {
		expect(readStoredSelection()).toEqual(DEFAULT_SELECTION);
	});

	it('keeps everything but the moment in time, and the ticket filter', () => {
		storeSelection({
			scope: 'month',
			offset: 4,
			zoom: {start: 1000, end: 2000},
			layout: 'real',
			view: 'tagging',
			only: {tag: ['bug'], assignee: ['jola']},
			windowOnly: true,
			ticketOnly: false,
		});

		expect(readStoredSelection()).toEqual({
			scope: 'month',
			offset: 0,
			zoom: null,
			layout: 'real',
			view: 'tagging',
			only: {tag: ['bug'], assignee: ['jola']},
			// Not kept: a filter that hides tickets is not a preference to come
			// back to days later.
			windowOnly: false,
			ticketOnly: false,
		});
	});

	// Written before each axis carried its own list, when the stored view was
	// the axis.
	it('reads a stored bare list onto the axis the stored view colours by', () => {
		localStorage.setItem(
			'epiq.board.selection',
			'{"scope":"all","layout":"even","view":"assigning","only":["jola"]}',
		);
		expect(readStoredSelection().only).toEqual({assignee: ['jola']});

		localStorage.setItem(
			'epiq.board.selection',
			'{"scope":"all","layout":"even","view":"all","only":["jola"]}',
		);
		expect(readStoredSelection().only).toEqual({});
	});

	it('shrugs off garbage', () => {
		localStorage.setItem('epiq.board.selection', '{not json');
		expect(readStoredSelection()).toEqual(DEFAULT_SELECTION);

		localStorage.setItem('epiq.board.selection', '{"scope":"never","only":3}');
		expect(readStoredSelection()).toEqual(DEFAULT_SELECTION);
	});
});

describe('carried selection', () => {
	// What the hook does with these: derive the selection from the query, or
	// from the carried values when the query says nothing, then offer that
	// selection back to the carry.
	const derive = (carry: SelectionCarry, query: string): BoardSelection =>
		readSelectionParams(params(query)) ?? {
			...readStoredSelection(),
			...carry.values,
		};

	const render = (carry: SelectionCarry, query: string) => {
		const selection = derive(carry, query);
		return {carry: carryRender(carry, query, selection), selection};
	};

	it('picks the four up from a query that names them', () => {
		const {carry} = render(DEFAULT_CARRY, 'ticket=1&scope=week&offset=2');
		expect(carry.values.ticketOnly).toBe(true);
		expect(carry.values.offset).toBe(2);
	});

	it('hands them to a query that has been rebuilt without them', () => {
		const {carry} = render(DEFAULT_CARRY, 'ticket=1');
		const opened = render(carry, '');
		expect(opened.selection.ticketOnly).toBe(true);
	});

	// The bug: a change is two steps — the carried values, then the URL a
	// render later — and a re-render from anywhere else lands in between still
	// holding the pre-change query. Unkeyed it read the switched-off narrowing
	// back over the change, and the empty query then put it straight back on.
	it('survives a re-render landing between the change and its URL', () => {
		let {carry} = render(DEFAULT_CARRY, 'ticket=1');

		const next = applySelectionPatch(derive(carry, 'ticket=1'), {
			ticketOnly: false,
		});
		carry = carryChange(carry, next);

		({carry} = render(carry, 'ticket=1'));

		expect(render(carry, '').selection.ticketOnly).toBe(false);
	});

	// The same guard must not stick: once the query really does move on, what
	// it says is newer than anything held here.
	it('takes up what a later query says', () => {
		let {carry} = render(DEFAULT_CARRY, 'ticket=1');
		carry = carryChange(carry, {...derive(carry, 'ticket=1'), offset: 3});

		({carry} = render(carry, 'window=1'));
		expect(carry.values.windowOnly).toBe(true);
		expect(carry.values.ticketOnly).toBe(false);
		expect(carry.values.offset).toBe(0);
	});
});

describe('narrowing', () => {
	const listed = [bug, docs, gui];

	it('hides nothing until narrowed, then whatever is not named', () => {
		expect(hiddenIdsFor(listed, null).size).toBe(0);
		expect([...hiddenIdsFor(listed, ['docs'])]).toEqual(['bug', 'gui']);
		expect([...hiddenIdsFor(listed, [])]).toEqual(['bug', 'docs', 'gui']);
	});

	it('unticking one names the rest', () => {
		expect(toggleOnly(null, listed, 'docs', false)).toEqual(['bug', 'gui']);
		expect(toggleOnly(['bug', 'gui'], listed, 'bug', false)).toEqual(['gui']);
	});

	it('ticking the last one back restores everything', () => {
		expect(toggleOnly(['bug', 'gui'], listed, 'docs', true)).toBeNull();
		expect(toggleOnly(['bug'], listed, 'docs', true)).toEqual(['bug', 'docs']);
	});

	it('isolates, and isolating again is the way back', () => {
		expect(isolateOnly(null, 'bug')).toEqual(['bug']);
		expect(isolateOnly(['bug', 'docs'], 'bug')).toEqual(['bug']);
		expect(isolateOnly(['bug'], 'docs')).toEqual(['docs']);
		expect(isolateOnly(['bug'], 'bug')).toBeNull();
	});

	it('lists a selected identity the window has no event for, if known', () => {
		expect(withSelectedIdentities([bug], ['gui'], [gui, docs])).toEqual([
			bug,
			gui,
		]);
		// Unknown ids stay off the legend rather than becoming nameless rows.
		expect(withSelectedIdentities([bug], ['ghost'], [gui])).toEqual([bug]);
		expect(withSelectedIdentities([bug], null, [gui])).toEqual([bug]);
	});
});
