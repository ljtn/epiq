import {beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {readReviewedFiles} from './reviewed-files';

const STORAGE_KEY = 'epiq.commits.reviewedFiles';

describe('readReviewedFiles', () => {
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

	it('is empty when nothing is stored', () => {
		expect(readReviewedFiles()).toEqual(new Set());
	});

	it('reads back the stored keys', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(['abc:a.ts', 'def:b.ts']));

		expect(readReviewedFiles()).toEqual(new Set(['abc:a.ts', 'def:b.ts']));
	});

	it('reads anything malformed as nothing reviewed', () => {
		localStorage.setItem(STORAGE_KEY, '{not json');
		expect(readReviewedFiles()).toEqual(new Set());

		localStorage.setItem(STORAGE_KEY, '{"abc:a.ts": true}');
		expect(readReviewedFiles()).toEqual(new Set());

		localStorage.setItem(STORAGE_KEY, JSON.stringify(['abc:a.ts', 3, null]));
		expect(readReviewedFiles()).toEqual(new Set(['abc:a.ts']));
	});
});
