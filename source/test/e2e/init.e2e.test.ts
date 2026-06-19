import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {ARROW_DOWN, ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_COMMAND_LINE = ': for command line';

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		tui.destroy();
	}
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

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				tui.input(`:new issue ${issueTitle}`, ENTER);

				const output = await tui.waitFor('Todo (1)');

				expect(output).toContain(issueTitle);
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
	it(
		'Can rename an issue, and tab to auto-complete the title',
		async () => {
			const tui = setupTui();

			try {
				const issueTitle = 'Test create issue';
				const TAB = '\x09';

				await commonSteps.init(tui);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				tui.input(`:new issue ${issueTitle}`, ENTER);
				await tui.waitFor('Todo (1)');

				tui.input(`:edit tit`);
				tui.input(TAB);

				// Should have been auto-completed with old title
				await tui.waitFor('edit title Test create issue');

				// Delete last word by pressing meta+Backspace (option+backspace on Mac)
				tui.input('\x1b\x7f');
				tui.input('EDITED');
				const output = await tui.waitFor('edit title Test create EDITED');
				expect(output).toContain('edit title Test create EDITED');

				tui.input(ENTER);

				const finalOutput = await tui.waitFor(
					output =>
						output.includes('Test create EDITED') && !output.includes(':edit'),
				);

				expect(finalOutput).not.toContain(':edit title Test create EDITED');
				expect(finalOutput).toContain('Test create EDITED');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'Can tag an issue, untag an issue and view issue details',
		async () => {
			const tui = setupTui();

			try {
				const issueTitle = 'Test create issue';

				await commonSteps.init(tui);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				tui.input(`:new issue ${issueTitle}`, ENTER);
				await tui.waitFor('Todo (1)');

				tui.input(':tag prio', ENTER);
				await tui.waitFor('Mode: default');
				await tui.waitFor('prio');

				tui.input(':tag important', ENTER);
				await tui.waitFor('Mode: default');

				const tagOutput = await tui.waitFor(
					/prio[\s\S]*important|important[\s\S]*prio/,
				);

				expect(tagOutput).toContain('prio');
				expect(tagOutput).toContain('important');

				tui.input(':untag prio', ENTER);
				await tui.waitFor('Mode: default');

				const untagOutput = await tui.waitFor(
					output => output.includes('important') && !output.includes('prio'),
				);

				expect(untagOutput).toContain('important');
				expect(untagOutput).not.toContain('prio');

				await tui.waitFor(EMPTY_COMMAND_LINE);

				tui.input(ENTER);

				const detailOutput = await tui.waitFor('History ››');

				expect(detailOutput).toContain('Description');
				expect(detailOutput).toContain('Assignees:');
				expect(detailOutput).toContain('important');
				expect(detailOutput).toContain('History ››');

				tui.input(ARROW_DOWN, ARROW_DOWN, ARROW_DOWN, ENTER);

				await tui.waitFor('Event log');
				const logOutput = await tui.waitFor(
					'Created with title "Test create issue"',
				);
				const normalizedLogOutput = logOutput.replace(/\s{2,}/g, ' ');

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
