import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps, fileIssue} from './e2e-common-steps.js';
import {ARROW_UP, ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 120_000;

const CLEAR_SCREEN = '\x1B[2J';
const FRAME_START = '\x1B[?2026h';

const selects = (title: string) => (frame: string) =>
	frame.includes(`▸ ${title}`);

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui, 'off');
	} finally {
		await tui.destroy();
	}
});

describe('TUI redraw e2e', () => {
	it(
		'moving the selection rewrites only what changed, without clearing the screen',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)', 20_000);

				await fileIssue(tui, 'Redraw one', 1);
				await fileIssue(tui, 'Redraw two', 2);
				await tui.waitFor(selects('Redraw two'), 10_000);

				tui.takeWritten();
				tui.input(ARROW_UP);
				await tui.waitFor(selects('Redraw one'), 10_000);
				const update = tui.takeWritten();

				expect(update).not.toContain(CLEAR_SCREEN);
				// A whole 120x20 frame with colour is several kilobytes.
				expect(update.length).toBeLessThan(1500);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'keys typed while it boots are never echoed under the first frame',
		async () => {
			const tui = setupTui();

			try {
				// Escape, which the TUI ignores on its first screen, typed from launch
				// until the first frame has landed.
				tui.takeWritten();
				let written = '';
				const deadline = Date.now() + 20_000;
				while (!written.includes(FRAME_START) && Date.now() < deadline) {
					tui.input('\x1B');
					await new Promise(resolve => setTimeout(resolve, 3));
					written += tui.takeWritten();
				}

				const frame = await tui.waitFor(
					output => output.includes('Initialize project'),
					20_000,
				);
				const rows = frame.split('\n');

				expect(frame).not.toContain('^[');
				expect(rows[0]).toContain('Mode:');
				expect(rows.at(-1)?.trim()).toMatch(/^╰─+╯$/);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'draws in a shell that exports CI',
		async () => {
			const tui = setupTui([], {env: {CI: 'true'}});

			try {
				await tui.waitFor(output => output.includes('Mode:'), 20_000);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
