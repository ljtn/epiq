import {expect} from 'vitest';
import {setupTui} from './e2e.helper.js';
import {execSync} from 'child_process';

export const commonSteps = {
	configureInitialSettings: async (tui: ReturnType<typeof setupTui>) => {
		// Headroom for a cold start on slow CI hardware.
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

		// Wait on the asserted text, not the title: they arrive in separate chunks.
		output = await tui.waitFor(
			'This folder is not an epiq project yet.',
			8_000,
		);

		expect(output).toContain('This folder is not an epiq project yet.');

		// ENTER must be a separate chunk, or it is handled before the command is
		// committed and the confirm is dropped.
		tui.input(':init');
		await tui.waitFor('<ENTER> to confirm', 8_000);
		tui.input('\r');

		output = await tui.waitFor('Default (0 issues)', 8_000);

		return output;
	},
};
