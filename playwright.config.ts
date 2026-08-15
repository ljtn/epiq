import {defineConfig} from '@playwright/test';

export default defineConfig({
	testDir: './source/test/e2e-gui',
	// Not *.spec.ts: vitest's default include would otherwise pick these up and
	// run them under the wrong runner.
	testMatch: '**/*.pw.ts',
	globalSetup: './source/test/e2e-gui/global-setup.ts',
	// One GUI server over one repo, so parallel workers would race on shared
	// state the way the TUI e2e files do.
	workers: 1,
	fullyParallel: false,
	forbidOnly: Boolean(process.env['IS_CI']),
	retries: 0,
	reporter: process.env['IS_CI'] ? 'list' : 'line',
	timeout: 30_000,
	expect: {timeout: 10_000},
	use: {
		headless: true,
		trace: 'retain-on-failure',
	},
});
