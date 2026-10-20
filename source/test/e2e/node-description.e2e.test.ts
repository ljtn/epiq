import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {isFail, Result} from '../../lib/model/result-types.js';
import {listBoards, listSwimlanes} from '../../mcp/epiq-api.js';
import {commonSteps} from './e2e-common-steps.js';
import {
	ARROW_DOWN,
	commandLineIsIdle,
	commandLineShows,
	ENTER,
	removeTempRepo,
	setupTui,
} from './e2e.helper.js';

const testTimeout = 60_000;
const ESCAPE = '\x1B';

type Tui = ReturnType<typeof setupTui>;

// Its own HOME, as edit-scope has, so the editor setting below cannot reach
// another file's sessions through the shared config.
const E2E_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-home-'));

// Writes a fixed text and exits, so `edit description` needs no human.
const fakeEditor = path.resolve(
	process.cwd(),
	'source/test/e2e/fake-editor.sh',
);
const WRITTEN = 'Implemented during the e2e flow';

const ENV = {
	HOME: E2E_HOME,
	EDITOR: fakeEditor,
	GIT_AUTHOR_NAME: 'Epiq E2E',
	GIT_AUTHOR_EMAIL: 'e2e@example.com',
	GIT_COMMITTER_NAME: 'Epiq E2E',
	GIT_COMMITTER_EMAIL: 'e2e@example.com',
};

const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(commandLineShows(echo), 4_000);
	tui.input(ENTER);
	await tui.waitFor(commandLineIsIdle, 5_000);
};

// Read back through the API, as the diff suite reads tickets: the TUI shows a
// ticket's description but not a board's or a lane's.
const descriptionOf = async (
	cwd: string,
	list: 'boards' | 'lanes',
	title: string,
): Promise<string | undefined> => {
	const nodes = await (list === 'boards'
		? listBoards({repoRoot: cwd}).then(valueOf)
		: listSwimlanes({repoRoot: cwd}).then(valueOf));

	return nodes.find(node => node.title === title)?.description;
};

const valueOf = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

beforeAll(async () => {
	const tui = setupTui([], {env: ENV});

	try {
		await commonSteps.configureInitialSettings(tui, 'off');
	} finally {
		await tui.destroy();
	}
});

afterAll(() => {
	removeTempRepo(E2E_HOME);
});

describe('TUI board and lane descriptions e2e', () => {
	it(
		'`edit description` writes the selected board’s, then the selected lane’s',
		async () => {
			const tui = setupTui([], {env: ENV});

			try {
				await commonSteps.init(tui);
				await run(tui, ':config editor $EDITOR', 'config editor $EDITOR');

				// The Default board is the selection at the top level.
				await expectCompletes(tui, ':edit des', ':edit description');
				await run(tui, ':edit description', 'edit description');
				await expect
					.poll(() => descriptionOf(tui.cwd, 'boards', 'Default'), {
						timeout: 8_000,
					})
					.toBe(WRITTEN);

				// Into the board, where its first lane is the selection.
				tui.input(ENTER);
				await tui.waitFor('Todo (0)', 4_000);

				await expectCompletes(tui, ':edit des', ':edit description');
				await run(tui, ':edit description', 'edit description');
				await expect
					.poll(() => descriptionOf(tui.cwd, 'lanes', 'Todo'), {
						timeout: 8_000,
					})
					.toBe(WRITTEN);

				// Only the lane that was selected.
				expect(await descriptionOf(tui.cwd, 'lanes', 'Done')).toBeUndefined();
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'refuses the locked Closed board',
		async () => {
			const tui = setupTui([], {env: ENV});

			try {
				await commonSteps.init(tui);
				await run(tui, ':config editor $EDITOR', 'config editor $EDITOR');

				tui.input(ARROW_DOWN);
				await tui.waitFor(/❯\s+Closed/, 4_000);

				tui.input(':edit description');
				await tui.waitFor(commandLineShows('edit description'), 4_000);
				tui.input(ENTER);
				await tui.waitFor('Cannot edit readonly node', 5_000);

				expect(
					await descriptionOf(tui.cwd, 'boards', 'Closed'),
				).toBeUndefined();
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});

// The inline completion renders as ghost text after the cursor, so the line
// reads as the whole command though only the prefix was typed.
const expectCompletes = async (
	tui: Tui,
	partial: string,
	completed: string,
) => {
	tui.input(partial);
	expect(
		await tui.waitFor(screen => screen.includes(completed), 4_000),
	).toContain(completed);
	tui.input(ESCAPE);
	await tui.waitFor(commandLineIsIdle, 4_000);
};
