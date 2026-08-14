import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = 'for command line';

type Tui = ReturnType<typeof setupTui>;

// Run a command-line command and wait for it to fully settle. Commands are
// echoed into the (async) command-line buffer first, so we wait for the echo,
// then submit, then wait for the line to clear. Firing the next command before
// this completes lets keystrokes merge into a single un-submitted buffer.
const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(echo, 4_000);
	tui.input(ENTER);
	await tui.waitFor(EMPTY_CMD, 5_000);
};

// A newly created issue becomes the selected node, so `:tag` / `:assign`
// immediately following `:new issue` apply to that issue.
const createIssue = async (
	tui: Tui,
	title: string,
	tag: string,
	assignee: string,
) => {
	await run(tui, `:new issue ${title}`, `new issue ${title}`);
	await run(tui, `:tag ${tag}`, `tag ${tag}`);
	// "!" marks a deliberately unlinked assignee. Assign refuses an unknown
	// name without it, so that a typo can't quietly mint a near-duplicate
	// contributor — and these fixtures are exactly that case: people who have
	// never authored an event.
	await run(tui, `:assign !${assignee}`, `assign !${assignee}`);
};

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui);
	} finally {
		tui.destroy();
	}
});

describe('TUI board filtering e2e', () => {
	it(
		'shows only issues matching the active filter and hides the rest',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				tui.input(ENTER);
				await tui.waitFor('Todo (0)');

				// Three issues spanning two tags and two assignees, so every filter
				// below has both a matching and a non-matching issue to discriminate.
				// Titles are kept short so they render in full (the card truncates
				// long ones), which lets us assert on exact title text.
				//   Login bug -> tag frontend, assignee alice
				//   DB sync   -> tag backend,  assignee bob
				//   Nav menu  -> tag frontend, assignee bob
				await createIssue(tui, 'Login bug', 'frontend', 'alice');
				await createIssue(tui, 'DB sync', 'backend', 'bob');
				await createIssue(tui, 'Nav menu', 'frontend', 'bob');

				await tui.waitFor('Todo (3)', 4_000);

				// --- Filter by tag: only the two `frontend` issues survive. ---
				await run(tui, ':filter tag frontend', 'filter tag frontend');
				const byTag = await tui.waitFor(
					output =>
						output.includes('APPLIED FILTERS:') &&
						output.includes('Login bug') &&
						output.includes('Nav menu') &&
						!output.includes('DB sync'),
					4_000,
				);
				expect(byTag).toContain('Login bug');
				expect(byTag).toContain('Nav menu');
				expect(byTag).not.toContain('DB sync');

				await run(tui, ':filter clear', 'filter clear');
				// Clearing brings every issue back.
				await tui.waitFor(
					output =>
						output.includes('DB sync') && !output.includes('APPLIED FILTERS:'),
					4_000,
				);

				// --- Filter by assignee: only the two issues owned by `bob`. ---
				await run(tui, ':filter assignee bob', 'filter assignee bob');
				const byAssignee = await tui.waitFor(
					output =>
						output.includes('APPLIED FILTERS:') &&
						output.includes('DB sync') &&
						output.includes('Nav menu') &&
						!output.includes('Login bug'),
					4_000,
				);
				expect(byAssignee).toContain('DB sync');
				expect(byAssignee).toContain('Nav menu');
				expect(byAssignee).not.toContain('Login bug');

				await run(tui, ':filter clear', 'filter clear');
				await tui.waitFor(
					output =>
						output.includes('Login bug') &&
						!output.includes('APPLIED FILTERS:'),
					4_000,
				);

				// --- Filter by title: a single matching issue. ---
				await run(tui, ':filter title Login', 'filter title Login');
				const byTitle = await tui.waitFor(
					output =>
						output.includes('APPLIED FILTERS:') &&
						output.includes('Login bug') &&
						!output.includes('DB sync') &&
						!output.includes('Nav menu'),
					4_000,
				);
				expect(byTitle).toContain('Login bug');
				expect(byTitle).not.toContain('DB sync');
				expect(byTitle).not.toContain('Nav menu');
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
});
