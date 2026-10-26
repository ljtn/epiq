import {expect} from 'vitest';
import {commandLineIsIdle, commandLineShows, setupTui} from './e2e.helper.js';
import {execSync} from 'child_process';

/**
 * Empties the command line, then types and confirms a command. Backspace, not
 * escape: a lone escape merges with the next key as alt.
 */
export const typeCommand = async (
	tui: {
		input: (...values: string[]) => void;
		waitFor: (
			text: string | RegExp | ((output: string) => boolean),
			timeoutMs?: number,
		) => Promise<string>;
	},
	command: string,
) => {
	tui.input('\x7f'.repeat(60));
	await tui.waitFor(commandLineIsIdle, 20_000);

	tui.input(command);
	await tui.waitFor(commandLineShows(command.replace(/^:/, '')), 20_000);

	tui.input('\r');
};

/**
 * Files an issue into Todo and waits for the lane count: the title also shows
 * in the typed command's echo, so waiting on it proves nothing.
 */
export const fileIssue = async (
	tui: {
		input: (...values: string[]) => void;
		waitFor: (
			text: string | RegExp | ((output: string) => boolean),
			timeoutMs?: number,
		) => Promise<string>;
	},
	title: string,
	count: number,
): Promise<string> => {
	await typeCommand(tui, `:new issue ${title}`);

	try {
		return await tui.waitFor(`Todo (${count})`, 20_000);
	} catch {
		tui.input('\r');
		return await tui.waitFor(`Todo (${count})`, 20_000);
	}
};

export const commonSteps = {
	// `autoSync` is the one answer worth varying: a suite that only exercises
	// the interface wants no background git work behind it.
	configureInitialSettings: async (
		tui: ReturnType<typeof setupTui>,
		autoSync: 'on' | 'off' = 'on',
	) => {
		// Headroom for a cold start on slow CI hardware, or under a full container.
		await tui.waitFor('choose your username', 20_000);
		await typeCommand(tui, ':config username test');

		await tui.waitFor('pick your editor', 20_000);
		await typeCommand(tui, ':config editor vim');

		await tui.waitFor('Configure auto sync', 20_000);
		await typeCommand(tui, `:config autoSync ${autoSync}`);

		await tui.waitFor('Initialize project', 20_000);
	},

	/**
	 * Declines the claiming step, when there is one: a claim would change every
	 * seeded board. Asked once per HOME, so a later project may skip it.
	 */
	declineEmails: async (tui: {
		input: (...values: string[]) => void;
		waitFor: (
			text: string | RegExp | ((output: string) => boolean),
			timeoutMs?: number,
		) => Promise<string>;
	}) => {
		const frame = await tui.waitFor(
			output =>
				output.includes('Claim the git addresses') ||
				output.includes('Default (0 issues)'),
			20_000,
		);

		if (!frame.includes('Claim the git addresses')) return;

		await typeCommand(tui, ':config emails none');
	},

	init: async (tui: {
		cwd: string;
		input: (...values: string[]) => void;
		output: () => string;
		waitFor: (
			text: string | RegExp | ((output: string) => boolean),
			timeoutMs?: number,
		) => Promise<string>;
		destroy: () => Promise<void>;
	}) => {
		let output;
		execSync('git init', {
			cwd: tui.cwd,
			stdio: 'ignore',
		});

		// Wait on the asserted text, not the title: they arrive in separate chunks.
		output = await tui.waitFor(
			'This folder is not an epiq project yet.',
			20_000,
		);

		expect(output).toContain('This folder is not an epiq project yet.');

		await typeCommand(tui, ':init');
		await commonSteps.declineEmails(tui);

		output = await tui.waitFor('Default (0 issues)', 20_000);

		return output;
	},
};
