import {execFileSync, execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {removeTempRepo, setupTui} from './e2e.helper.js';

// A git stand-in the TUI resolves ahead of the real one: it holds every push,
// shrugging off the hangup the pty sends when the TUI dies, and keeps writing
// into the repo's `.epiq` the whole time — the child that outlives the TUI and
// repopulates the directory the teardown is trying to remove.
const fakeGit = (): {binDir: string; holdDir: string} => {
	const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-fakegit-'));
	const holdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-hold-'));
	const realGit = execFileSync('sh', ['-c', 'command -v git'], {
		encoding: 'utf8',
	}).trim();

	fs.writeFileSync(
		path.join(binDir, 'git'),
		[
			'#!/bin/sh',
			'if [ "$1" = push ]; then',
			"  trap '' HUP INT TERM",
			`  : > "${path.join(holdDir, 'held')}"`,
			'  i=0; while [ $i -lt 300 ]; do',
			'    mkdir -p "$EPIQ_E2E_REPO/.epiq/hold" && : > "$EPIQ_E2E_REPO/.epiq/hold/$i"',
			'    sleep 0.1; i=$((i+1))',
			'  done',
			'fi',
			`exec "${realGit}" "$@"`,
			'',
		].join('\n'),
		{mode: 0o755},
	);

	return {binDir, holdDir};
};

const waitForFile = async (file: string, timeoutMs: number): Promise<void> => {
	const deadline = Date.now() + timeoutMs;

	while (!fs.existsSync(file)) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}`);
		await new Promise(resolve => setTimeout(resolve, 50));
	}
};

describe('TUI e2e teardown', () => {
	it('destroy() takes the whole process group down, not just the TUI', async () => {
		const {binDir, holdDir} = fakeGit();
		const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-teardown-'));
		const tui = setupTui([], {
			cwd: repo,
			env: {
				PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
				EPIQ_E2E_REPO: repo,
			},
		});

		await commonSteps.configureInitialSettings(tui);

		// Init pushes the state branch before the board renders, so this drives
		// init by hand and waits for the push to be held rather than for a frame.
		execSync('git init', {cwd: tui.cwd, stdio: 'ignore'});
		await tui.waitFor('This folder is not an epiq project yet.', 8_000);
		tui.input(':init');
		await tui.waitFor('<ENTER> to confirm', 8_000);
		tui.input('\r');
		await waitForFile(path.join(holdDir, 'held'), 10_000);

		await tui.destroy();

		// A writer that survived teardown would put the directory straight back.
		removeTempRepo(repo);
		await new Promise(resolve => setTimeout(resolve, 500));
		expect(fs.existsSync(repo)).toBe(false);
	}, 60_000);
});
