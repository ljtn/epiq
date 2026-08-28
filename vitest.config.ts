import {configDefaults, defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		// Fails a test that aims git at the checkout instead of a temp dir.
		setupFiles: ['source/test/setup/no-git-outside-tmp.ts'],
		// Worktrees live under `.claude/worktrees`, and a checkout of a code
		// branch there carries its own copy of every test. Without this they run
		// twice, and the e2e ones run on the host rather than in their container.
		exclude: [...configDefaults.exclude, '.claude/**'],
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'html', 'lcov'],
			reportsDirectory: './coverage',
		},
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
