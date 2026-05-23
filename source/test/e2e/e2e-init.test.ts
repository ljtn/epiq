import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {setupTui} from './e2e.helper.js';

const testTimeout = 10_000;

beforeAll(async () => {
	// Skip tests in CI to avoid issues with pseudo-terminals
	const tui = setupTui();

	try {
		// Only run once
		await commonSteps.configureInitialSettings(tui);

		let output = await tui.waitFor('Initialize project');

		expect(output).toContain('This folder is not an epiq project yet.');

		tui.input(':init\r');
		output = await tui.waitFor('Not inside a Git repository');

		expect(output).toContain('Not inside a Git repository');
	} finally {
		tui.destroy();
	}
});

describe('TUI e2e', () => {
	it.concurrent(
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
	it.concurrent(
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
});
