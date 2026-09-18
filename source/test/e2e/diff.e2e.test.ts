import {execSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {beforeAll, describe, expect, it} from 'vitest';
import {isFail} from '../../lib/model/result-types.js';
import {listIssues} from '../../mcp/epiq-api.js';
import {commonSteps} from './e2e-common-steps.js';
import {
	ARROW_DOWN,
	commandLineIsIdle,
	commandLineShows,
	ENTER,
	setupTui,
} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = commandLineIsIdle;

type Tui = ReturnType<typeof setupTui>;

const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(commandLineShows(echo), 4_000);
	tui.input(ENTER);
	await tui.waitFor(EMPTY_CMD, 5_000);
};

const git = (cwd: string, args: string) =>
	execSync(`git ${args}`, {cwd, stdio: 'ignore'});

// A commit whose subject carries the ref is what links it to the ticket; one
// that does not must stay out of the list, which is the half of the matching
// that a passing "shows three commits" would not notice.
const commit = (cwd: string, subject: string, file: string) => {
	fs.writeFileSync(path.join(cwd, file), `export const a = '${file}';\n`);
	git(cwd, 'add -A');
	git(cwd, `commit -q --no-verify -m ${JSON.stringify(subject)}`);
};

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui, 'off');
	} finally {
		await tui.destroy();
	}
});

describe('TUI diff e2e', () => {
	it(
		'lists the ticket’s own commits under Diff and leaves other tickets’ out',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				// The container has no global git identity, and a commit needs one.
				git(tui.cwd, 'config user.name e2e');
				git(tui.cwd, 'config user.email e2e@example.com');

				tui.input(ENTER);
				await tui.waitFor('Todo (0)', 4_000);

				await run(tui, ':new issue Diff target', 'Diff target');
				await tui.waitFor('Todo (1)', 4_000);

				const issues = await listIssues({repoRoot: tui.cwd});
				if (isFail(issues)) throw new Error(issues.message);

				const ref = issues.value[0]?.ref;
				expect(ref).toBeTruthy();

				commit(tui.cwd, `${ref} the first thing`, 'one.ts');
				commit(tui.cwd, 'ZZZZZZZ another ticket entirely', 'two.ts');
				commit(tui.cwd, `${ref} the second thing`, 'three.ts');

				// Into the ticket, then down to the Diff row. Every press is
				// confirmed on the row it lands on before the next goes out, the
				// way the comments suite walks this same list.
				tui.input(ENTER);
				await tui.waitFor('Diff ››', 4_000);

				for (const row of [
					/❯\s+Assignees/,
					/❯\s+Tags/,
					/❯\s+History/,
					/❯\s+Diff/,
				]) {
					tui.input(ARROW_DOWN);
					await tui.waitFor(row, 4_000);
				}

				tui.input(ENTER);

				// Both subjects, so the assertion cannot pass on a half-drawn list.
				const listed = await tui.waitFor(
					frame =>
						frame.includes('the first thing') &&
						frame.includes('the second thing'),
					10_000,
				);

				expect(listed).toContain('Diff (2)');
				expect(listed).toContain('o to open in your editor');
				expect(listed).not.toContain('another ticket entirely');

				// `o` hands the commit to the configured editor (`vim` here, which
				// this container has no terminal for). Whatever comes of that, the
				// TUI must still be taking input — so move the cursor afterwards and
				// wait for it to land. Waiting on text that is already on screen
				// would pass whether or not the TUI was still alive.
				tui.input('o');
				tui.input(ARROW_DOWN);
				const afterOpen = await tui.waitFor(/❯.*the first thing/, 6_000);
				expect(afterOpen).toContain('Diff (2)');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'reads a commit’s patch in place, and q comes back to the list',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				git(tui.cwd, 'config user.name e2e');
				git(tui.cwd, 'config user.email e2e@example.com');

				tui.input(ENTER);
				await tui.waitFor('Todo (0)', 4_000);

				await run(tui, ':new issue Patch target', 'Patch target');
				await tui.waitFor('Todo (1)', 4_000);

				const issues = await listIssues({repoRoot: tui.cwd});
				if (isFail(issues)) throw new Error(issues.message);
				const ref = issues.value[0]?.ref;

				// A base to diff against, then a change that removes one line, adds
				// another and leaves context around both.
				fs.writeFileSync(
					path.join(tui.cwd, 'thing.ts'),
					['const keep = 1;', 'const drop = 2;', 'const also = 3;', ''].join(
						'\n',
					),
				);
				git(tui.cwd, 'add -A');
				git(
					tui.cwd,
					`commit -q --no-verify -m ${JSON.stringify(`${ref} base`)}`,
				);

				fs.writeFileSync(
					path.join(tui.cwd, 'thing.ts'),
					['const keep = 1;', 'const fresh = 9;', 'const also = 3;', ''].join(
						'\n',
					),
				);
				git(tui.cwd, 'add -A');
				git(
					tui.cwd,
					`commit -q --no-verify -m ${JSON.stringify(`${ref} the change`)}`,
				);

				tui.input(ENTER);
				await tui.waitFor('Diff ››', 4_000);

				for (const row of [
					/❯\s+Assignees/,
					/❯\s+Tags/,
					/❯\s+History/,
					/❯\s+Diff/,
				]) {
					tui.input(ARROW_DOWN);
					await tui.waitFor(row, 4_000);
				}

				tui.input(ENTER);
				await tui.waitFor(/❯.*the change/, 10_000);

				// Into the newest commit's patch.
				tui.input(ENTER);
				const patch = await tui.waitFor('q to go back', 10_000);

				expect(patch).toContain('thing.ts');
				expect(patch).toMatch(/@@ -\d+(,\d+)? \+\d+(,\d+)? @@/);
				expect(patch).toContain('-const drop = 2;');
				expect(patch).toContain('+const fresh = 9;');
				// Context is drawn without a sign, so the unchanged line is there as
				// itself rather than as an addition.
				expect(patch).toContain('const keep = 1;');
				expect(patch).not.toContain('+const keep = 1;');

				// `enter to read`, not `o to open in your editor` — the pager's own
				// header carries that phrase too, so waiting on it would match the
				// frame that is already on screen and never prove `q` did anything.
				tui.input('q');
				const back = await tui.waitFor('enter to read', 6_000);
				expect(back).toContain('Diff (2)');
				expect(back).not.toContain('q to go back');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'says so when no commit references the ticket',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				git(tui.cwd, 'config user.name e2e');
				git(tui.cwd, 'config user.email e2e@example.com');
				commit(tui.cwd, 'ZZZZZZZ nothing to do with it', 'only.ts');

				tui.input(ENTER);
				await tui.waitFor('Todo (0)', 4_000);

				await run(tui, ':new issue Lonely ticket', 'Lonely ticket');
				await tui.waitFor('Todo (1)', 4_000);

				tui.input(ENTER);
				await tui.waitFor('Diff ››', 4_000);

				for (const row of [
					/❯\s+Assignees/,
					/❯\s+Tags/,
					/❯\s+History/,
					/❯\s+Diff/,
				]) {
					tui.input(ARROW_DOWN);
					await tui.waitFor(row, 4_000);
				}

				tui.input(ENTER);

				const empty = await tui.waitFor(
					'No commits reference this ticket.',
					10_000,
				);
				expect(empty).toContain('No commits reference this ticket.');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
