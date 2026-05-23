import {execSync} from 'node:child_process';
import {describe, expect, it} from 'vitest';
import {setupTui} from './e2e.helper.js';

const testTimeout = 10_000;

const configureFreshInstall = async (tui: ReturnType<typeof setupTui>) => {
	if (!process.env['CI'] && !process.env['GITHUB_ACTIONS']) {
		return;
	}

	let output = await tui.waitFor('Type  :config username');

	expect(output).toContain('choose your username');

	tui.input(':config username test\r');

	output = await tui.waitFor('Type  :config editor');

	expect(output).toContain('pick your editor');

	tui.input(':config editor vim\r');

	output = await tui.waitFor('Type  :config autoSync');

	expect(output).toContain('Configure auto sync');

	tui.input(':config autoSync on\r');

	await tui.waitFor('Initialize project');
};

describe('TUI e2e', () => {
	it(
		'Make sure you cannot initialize a project in a non-Git directory',
		async () => {
			const tui = setupTui();

			try {
				// Only run once
				await configureFreshInstall(tui);

				let output = await tui.waitFor('Initialize project');

				expect(output).toContain('This folder is not an epiq project yet.');

				tui.input(':init\r');
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

			const output = await commonSteps.init(tui);

			expect(output).toContain('Select a board:');
			expect(output).toContain('Default (0 issues)');
		},
		testTimeout,
	);
});

const commonSteps = {
	init: async (tui: {
		cwd: string;
		input: (value: string | string[]) => void;
		output: () => string;
		waitFor: (text: string, timeoutMs?: number) => Promise<string>;
		destroy: () => void;
	}) => {
		let output;
		try {
			execSync('git init', {
				cwd: tui.cwd,
				stdio: 'ignore',
			});

			output = await tui.waitFor('Initialize project');

			expect(output).toContain('This folder is not an epiq project yet.');
			tui.input(':init\r');

			output = await tui.waitFor('Default (0 issues)', 5000);
		} finally {
			tui.destroy();
		}
		return output;
	},
};
