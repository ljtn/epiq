import {describe, expect, it} from 'vitest';
import {OWN_REPO, prunedHidden, showsRepoToggles} from './commit-repo-filter';

describe('prunedHidden', () => {
	it('unhides a repo that is no longer registered, so it comes back shown', () => {
		const hidden = new Set(['api-0123456789ab', 'web-0123456789ab']);

		expect([...prunedHidden(hidden, ['web-0123456789ab'])]).toEqual([
			'web-0123456789ab',
		]);
	});

	it('keeps the board’s own repo, and the same set while nothing goes', () => {
		const hidden = new Set([OWN_REPO, 'web-0123456789ab']);

		expect(prunedHidden(hidden, ['web-0123456789ab'])).toBe(hidden);
		expect([...prunedHidden(hidden, [])]).toEqual([OWN_REPO]);
	});
});

describe('showsRepoToggles', () => {
	it('draws the toggles only while there is a choice', () => {
		expect(showsRepoToggles([OWN_REPO])).toBe(false);
		expect(showsRepoToggles([OWN_REPO, 'web-0123456789ab'])).toBe(true);
	});
});
