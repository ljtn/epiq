import {expect} from 'vitest';
import {setupTui} from './e2e.helper.js';
import {execSync} from 'child_process';

export const commonSteps = {
	configureInitialSettings: async (tui: ReturnType<typeof setupTui>) => {
		// Cold app start: parallel e2e files contend for CPU, so allow extra time
		// for the first frame rather than the default 3s.
		await tui.waitFor('choose your username', 8_000);
		tui.input(':config username test\r');

		await tui.waitFor('pick your editor');
		tui.input(':config editor vim\r');

		await tui.waitFor('Configure auto sync');
		tui.input(':config autoSync on\r');

		await tui.waitFor('Initialize project', 8_000);
	},

	init: async (tui: {
		cwd: string;
		input: (...values: string[]) => void;
		output: () => string;
		waitFor: (text: string, timeoutMs?: number) => Promise<string>;
		destroy: () => void;
	}) => {
		let output;
		execSync('git init', {
			cwd: tui.cwd,
			stdio: 'ignore',
		});

		// Cold app start: allow extra time for the first frame (see above).
		output = await tui.waitFor('Initialize project', 8_000);

		expect(output).toContain('This folder is not an epiq project yet.');
		tui.input(':init\r');

		output = await tui.waitFor('Default (0 issues)', 8_000);

		return output;
	},
};
