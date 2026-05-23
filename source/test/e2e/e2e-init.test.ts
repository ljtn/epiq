import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {setupTui} from './e2e.helper.js';

const testTimeout = 10_000;

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
		'Can tag an issue',
		async () => {
			const tui = setupTui();

			try {
				const issueTitle = 'Test create issue';
				await commonSteps.init(tui);

				tui.input('\r');

				await tui.waitFor('Todo (0)', 8_000);

				// Create an issue
				tui.input(`:new issue ${issueTitle}\r`);
				await tui.waitFor('Todo (1)', 8_000);

				// Tag the issue
				tui.input(`:tag test_tag\r`);
				const output = await tui.waitFor('■', 8_000);
				expect(output).toContain(' test_tag');

				// Enter the issue
				tui.input(`\r`);
				const detailOutput = await tui.waitFor('History ››', 8_000);

				expect(detailOutput).toContain('Description');
				expect(detailOutput).toContain('Assignees:');
				expect(detailOutput).toContain('test_tag');
				expect(detailOutput).toContain('History ››');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
});
