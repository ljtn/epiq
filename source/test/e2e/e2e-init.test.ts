import {execSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {setupTui} from './e2e.helper.js';
const testTimeout = 10_000;

describe('TUI e2e', () => {
	it(
		'Make sure you cannot initialize a project in a non-Git directory',
		async () => {
			const tui = setupTui();

			try {
				let output = await tui.waitFor('Initialize project');

				expect(output).toContain('This folder is not an epiq project yet.');

				tui.input(':');
				tui.input('init');
				tui.input('\r');

				output = await tui.waitFor('Not inside a Git repository');

				expect(output).toContain('Not inside a Git repository');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'Can initialize a project inside a Git repository',
		async () => {
			const tui = setupTui();

			try {
				execSync('git init', {
					cwd: tui.cwd,
					stdio: 'ignore',
				});

				let output = await tui.waitFor('Initialize project');

				tui.input(':');
				tui.input('init');
				tui.input('\r');

				output = await tui.waitFor('Default', 5000);

				expect(output).toContain('Select a board:');
				expect(output).toContain('Default (0 issues)');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
});
