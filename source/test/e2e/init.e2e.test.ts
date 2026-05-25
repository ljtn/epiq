import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {ARROW_DOWN, ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;

beforeAll(async () => {
	const tui = setupTui();
	await commonSteps.configureInitialSettings(tui);
});

describe('TUI e2e', () => {
	it(
		'Can initialize a project inside a Git repository',
		async () => {
			const tui = setupTui();

			try {
				const output = await commonSteps.init(tui);

				expect(output).toContain('Default (0 issues)');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
	it(
		'Can create an issue',
		async () => {
			const tui = setupTui();

			try {
				const issueTitle = 'Test create issue';
				await commonSteps.init(tui);

				tui.input('\r');

				await tui.waitFor('Todo (0)', 8_000);

				// Create an issue
				tui.input(`:new issue ${issueTitle}\r`);
				const output = await tui.waitFor('Todo (1)', 8_000);

				expect(output).toContain(issueTitle);
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
	it(
		'Can tag an issue, untag an issue and view issue details',
		async () => {
			const EMPTY_COMMAND_LINE = ': for command line';
			const tui = setupTui();

			try {
				const issueTitle = 'Test create issue';
				await commonSteps.init(tui);

				tui.input('\r');

				await tui.waitFor('Todo (0)', 8_000);

				// Create an issue
				tui.input(`:new issue ${issueTitle}`, ENTER);
				await tui.waitFor('Todo (1)', 8_000);

				// Tag the issue with a tag
				tui.input(`:tag prio`, ENTER);
				await tui.waitFor(EMPTY_COMMAND_LINE, 8_000);

				// Tag with another tag
				tui.input(`:tag important`, ENTER);
				const tagOutput = await tui.waitFor(EMPTY_COMMAND_LINE, 8_000);
				expect(tagOutput).toContain('prio');
				expect(tagOutput).toContain('important');

				// Untag the issue
				tui.input(`:untag prio`, ENTER);

				const untagOutput = await tui.waitFor(EMPTY_COMMAND_LINE, 8_000);
				expect(untagOutput).not.toContain('prio');
				expect(untagOutput).toContain('important');

				tui.input(ENTER);

				const detailOutput = await tui.waitFor('History ››', 8_000);

				expect(detailOutput).toContain('Description');
				expect(detailOutput).toContain('Assignees:');
				expect(detailOutput).toContain('important');
				expect(detailOutput).toContain('History ››');

				tui.input(ARROW_DOWN);
				tui.input(ARROW_DOWN);
				tui.input(ARROW_DOWN);
				tui.input(ENTER);

				const logOutput = await tui.waitFor('Event log', 8_000);
				const normalizedLogOutput = logOutput.replace(/\s{2,}/g, ' '); // Remove repeated whitespace for easier assertions
				expect(normalizedLogOutput).toContain('just now');
				expect(normalizedLogOutput).toContain(
					'Created with title "Test create issue"',
				);
				expect(normalizedLogOutput).toContain('Tagged with prio');
				expect(normalizedLogOutput).toContain('Tagged with important');
				expect(normalizedLogOutput).toContain('Removed tag prio');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
});
