import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		// Fails a test that aims git at the checkout instead of a temp dir.
		setupFiles: ['source/test/setup/no-git-outside-tmp.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'html', 'lcov'],
			reportsDirectory: './coverage',
		},
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
