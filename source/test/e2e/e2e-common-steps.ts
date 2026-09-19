import {expect} from 'vitest';
import {commandLineIsIdle, commandLineShows, setupTui} from './e2e.helper.js';
import {execSync} from 'child_process';

/**
 * Empties the command line, then types a command into it and confirms it.
 *
 * Setup opens each step with its command already typed, so a whole command
 * written on top of one lands as `:config editor :config editor vim`.
 * Backspace rather than escape: an escape written alone is still pending when
 * the next character arrives and the two are read as one alt-modified
 * keypress, so the line never opens and the characters fall through to the
 * board's own keys.
 *
 * Every step waits on a frame rather than a timer. Under a full container the
 * render lags far enough behind the keystrokes that a fixed pause sends the
 * command into a line still holding the last one.
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
 * Files an issue into Todo and does not come back until the lane says so.
 *
 * A submit can be dropped when the suite runs under load — the command then
 * sits typed in a line nothing is waiting on. The lane's count is what says
 * whether it ran: the typed command is echoed in the line, and the issue's
 * title is in that echo, so waiting on the title alone passes before Enter
 * has been handled at all.
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
	 * Answers the claiming step, when there is one.
	 *
	 * Declined: a fixture that claimed an address would put a link in every
	 * seeded board and change what the commit track says for every test.
	 *
	 * Asked once per machine, not once per project, and a file's tests share a
	 * `HOME`. So the second project on the same one goes straight to the board,
	 * and waiting for the step unconditionally hangs there.
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
