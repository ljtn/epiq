import {defineConfig} from '@playwright/test';

export default defineConfig({
	testDir: './source/test/e2e-gui',
	// Not *.spec.ts: vitest's default include would otherwise pick these up and
	// run them under the wrong runner.
	testMatch: '**/*.pw.ts',
	globalSetup: './source/test/e2e-gui/global-setup.ts',
	// Each worker gets its own GUI server over its own seeded repo (see
	// global-setup.ts), so files can run side by side; a file still runs whole
	// on one worker, so its tests share a server the way they always have.
	workers: 4,
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
