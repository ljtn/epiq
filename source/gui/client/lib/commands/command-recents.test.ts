import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {readRecentCommands, withCommandRemembered} from './command-recents';

const STORAGE_KEY = 'epiq.gui.recentCommands';

describe('recent commands', () => {
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

	it('is empty before anything has been run', () => {
		expect(readRecentCommands()).toEqual([]);
	});

	it('reads back what was stored', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(['sync', 'new']));

		expect(readRecentCommands()).toEqual(['sync', 'new']);
	});

	it('shrugs off anything that is not a list of strings', () => {
		localStorage.setItem(STORAGE_KEY, '{not json');
		expect(readRecentCommands()).toEqual([]);

		localStorage.setItem(STORAGE_KEY, '{"sync":1}');
		expect(readRecentCommands()).toEqual([]);

		localStorage.setItem(STORAGE_KEY, JSON.stringify(['sync', 3, null]));
		expect(readRecentCommands()).toEqual(['sync']);
	});

	it('puts the newest first', () => {
		expect(withCommandRemembered(['new'], 'sync')).toEqual(['sync', 'new']);
	});

	// Running something already in the list promotes it; it does not appear twice.
	it('promotes rather than duplicates', () => {
		expect(withCommandRemembered(['new', 'sync', 'close'], 'sync')).toEqual([
			'sync',
			'new',
			'close',
		]);
	});

	it('keeps only the last six', () => {
		const many = ['a', 'b', 'c', 'd', 'e', 'f'];

		expect(withCommandRemembered(many, 'g')).toEqual([
			'g',
			'a',
			'b',
			'c',
			'd',
			'e',
		]);
	});

	it('caps what it reads too, so a hand-grown list cannot fill the palette', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']),
		);

		expect(readRecentCommands()).toHaveLength(6);
	});
});
