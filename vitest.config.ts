import {configDefaults, defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		// Fails a test that aims git at the checkout instead of a temp dir.
		setupFiles: ['source/test/setup/no-git-outside-tmp.ts'],
		// Worktrees live under `.claude/worktrees`, and a checkout of a code
		// branch there carries its own copy of every test. Without this they run
		// twice, and the e2e ones run on the host rather than in their container.
		exclude: [...configDefaults.exclude, '.claude/**'],
		// Assertions compare rendered strings, so chalk must not decide on its
		// own whether to add escape codes. Terminals that export FORCE_COLOR
		// otherwise fail the suite that a plain shell passes.
		env: {FORCE_COLOR: '0'},
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'html', 'lcov'],
			reportsDirectory: './coverage',
		},
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
});
