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
			layout: 'real',
			view: 'tagging',
			only: ['bug', 'docs'],
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
		layout: 'even',
		view: 'tagging',
		only: ['bug'],
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

	it('keeps everything but the offset', () => {
		storeSelection({
			scope: 'month',
			offset: 4,
			layout: 'real',
			view: 'tagging',
			only: ['bug'],
		});

		expect(readStoredSelection()).toEqual({
			scope: 'month',
			offset: 0,
			layout: 'real',
			view: 'tagging',
			only: ['bug'],
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
