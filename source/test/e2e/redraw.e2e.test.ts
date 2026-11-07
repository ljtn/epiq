import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps, fileIssue} from './e2e-common-steps.js';
import {ARROW_UP, ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 120_000;

const CLEAR_SCREEN = '\x1B[2J';

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
});
