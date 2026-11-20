import {afterEach} from 'vitest';

// Every index built as the state changes, so none can go stale unnoticed.
process.env['EPIQ_CHECK_INDEXES'] = '1';

// After every test, every index beside the state agrees with it: a write that
// went around `setStateEntry` would leave one stale, here or in production.
// Imported late, so a test that mocks the state module gets its own mock.
afterEach(async () => {
	const state = (await import('../../lib/state/state.js')) as {
		indexDisagreements?: () => string[];
	};
	// A mock without it throws on being read: nothing real to check there.
	let check: (() => string[]) | undefined;
	try {
		check = state.indexDisagreements;
	} catch {
		return;
	}
	const found = check?.() ?? [];
	if (found.length > 0) {
		throw new Error(
			`An index beside the state disagrees with it (${found
				.slice(0, 5)
				.join('; ')}): something wrote around setStateEntry.`,
		);
	}
});
