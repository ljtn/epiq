import {expect} from 'vitest';
import {setupTui} from './e2e.helper.js';
import {execSync} from 'child_process';

export const commonSteps = {
	configureInitialSettings: async (tui: ReturnType<typeof setupTui>) => {
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
	},
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
