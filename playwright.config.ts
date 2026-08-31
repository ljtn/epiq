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
	//
	// A worker is not cheap: it seeds by driving a real TUI through a pty, then
	// holds two servers and a browser. Six of those want more than the four
	// vCPUs a hosted runner has, and the tests that suffer first are the ones
	// waiting on a state the app is trying to leave. A developer machine has
	// the cores to spare.
	workers: process.env['IS_CI'] ? 2 : 6,
	fullyParallel: false,
	forbidOnly: Boolean(process.env['IS_CI']),
	// One retry on CI only. Two known intermittents predate this suite running
	// there — `756310J` (a bulk tag reaching one of two tickets) and `GCYVZR3`
	// (a diff stat that has not landed inside one budget) — and at roughly one
	// run in five between them, a gate nobody can trust is a gate nobody reads.
	// This does not bury them: a test that fails and then passes is reported as
	// flaky by name, not as a pass, and the job stays red for anything that
	// fails twice. Drop this back to 0 once both are closed.
	retries: process.env['IS_CI'] ? 1 : 0,
	reporter: process.env['IS_CI'] ? 'list' : 'line',
	timeout: 30_000,
	expect: {timeout: 10_000},
	use: {
		headless: true,
		trace: 'retain-on-failure',
	},
});
