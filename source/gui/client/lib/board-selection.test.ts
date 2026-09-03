import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {GuiEventIdentity} from './gui-state.model';
import {
	applySelectionPatch,
	BoardSelection,
	DEFAULT_SELECTION,
	hasSelectionParams,
	hiddenIdsFor,
	isDefaultSelection,
	isolateOnly,
	readSelectionParams,
	readStoredSelection,
	storeSelection,
	toggleOnly,
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
			only: ['bug', 'docs'],
			windowOnly: true,
			ticketOnly: false,
		};

		expect(readSelectionParams(params(written(selection)))).toEqual(selection);
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
		expect(written({...DEFAULT_SELECTION, view: 'tagging', only: []})).toBe(
			'view=tagging&only=',
		);
		expect(readSelectionParams(params('view=tagging&only='))?.only).toEqual([]);
		expect(readSelectionParams(params('view=tagging'))?.only).toBeNull();
	});

	it('falls back per field on values it does not recognise', () => {
		expect(
			readSelectionParams(
				params('scope=fortnight&offset=x&layout=3d&view=nope&only=bug'),
			),
		).toEqual({...DEFAULT_SELECTION, only: ['bug']});
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
			readSelectionParams(params('view=tagging&only=bug,bug,docs'))?.only,
		).toEqual(['bug', 'docs']);
	});
});

describe('applySelectionPatch', () => {
	const narrowed: BoardSelection = {
		scope: 'week',
		offset: 3,
		zoom: null,
		layout: 'even',
		view: 'tagging',
		only: ['bug'],
		windowOnly: false,
		ticketOnly: false,
	};

	it('starts a new scope at its most recent period', () => {
		expect(applySelectionPatch(narrowed, {scope: 'day'}).offset).toBe(0);
		expect(applySelectionPatch(narrowed, {scope: 'week'}).offset).toBe(3);
	});

	it('drops the narrowing when the view changes, since its ids belonged to the old one', () => {
		expect(applySelectionPatch(narrowed, {view: 'assigning'}).only).toBeNull();
		expect(applySelectionPatch(narrowed, {view: 'tagging'}).only).toEqual([
			'bug',
		]);
	});

	it('lets a patch set the view and the narrowing together', () => {
		expect(
			applySelectionPatch(DEFAULT_SELECTION, {view: 'tagging', only: ['gui']}),
		).toEqual({...DEFAULT_SELECTION, view: 'tagging', only: ['gui']});
	});

	it('is the default once everything is put back', () => {
		expect(
			isDefaultSelection(
				applySelectionPatch(narrowed, {scope: 'all', view: 'all'}),
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
			only: ['bug'],
			windowOnly: true,
			ticketOnly: false,
		});

		expect(readStoredSelection()).toEqual({
			scope: 'month',
			offset: 0,
			zoom: null,
			layout: 'real',
			view: 'tagging',
			only: ['bug'],
			// Not kept: a filter that hides tickets is not a preference to come
			// back to days later.
			windowOnly: false,
			ticketOnly: false,
		});
	});

	it('shrugs off garbage', () => {
		localStorage.setItem('epiq.board.selection', '{not json');
		expect(readStoredSelection()).toEqual(DEFAULT_SELECTION);

		localStorage.setItem('epiq.board.selection', '{"scope":"never","only":3}');
		expect(readStoredSelection()).toEqual(DEFAULT_SELECTION);
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
