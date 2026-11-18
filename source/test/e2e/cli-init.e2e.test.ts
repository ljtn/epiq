import {execSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {commonSteps, typeCommand} from './e2e-common-steps.js';
import {ENTER, removeTempRepo, setupTui} from './e2e.helper.js';

// `epiq init` is a front door a script may knock on in any state: each one
// either starts a board or refuses, and a refusal leaves nothing behind. The
// tests share this file's machine config and run in order: no user, then an
// environment actor, then half a setup, then a whole one, which the repository
// states after it rely on.

const testTimeout = 90_000;
const cliPath = path.resolve(process.cwd(), 'dist/index.js');
const made: string[] = [];

const tempDir = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-init-'));
	made.push(dir);
	return dir;
};

const gitRepo = () => {
	const dir = tempDir();
	execSync('git init', {cwd: dir, stdio: 'ignore'});
	return dir;
};

afterAll(() => made.forEach(removeTempRepo));

// No actor unless a test names one, whatever the shell running the suite has.
const NO_ACTOR = {EPIQ_USER_NAME: '', EPIQ_USER_ID: ''};

const runInit = (
	cwd: string,
	env: Record<string, string> = {},
	args: string[] = ['init'],
) => {
	const result = spawnSync(process.execPath, [cliPath, ...args], {
		cwd,
		env: {...process.env, ...NO_ACTOR, ...env},
		encoding: 'utf8',
	});
	return {status: result.status, output: `${result.stdout}${result.stderr}`};
};

const git = (cwd: string, command: string) =>
	execSync(`git ${command}`, {cwd, encoding: 'utf8'}).trim();

/** What a refusal must not have changed: no project file, no branch, no commit. */
const gitFootprint = (cwd: string) => ({
	project: fs.existsSync(path.join(cwd, '.epiq')),
	refs: git(cwd, 'for-each-ref'),
	commits: git(cwd, 'rev-list --all --count'),
});

const EMPTY = {project: false, refs: '', commits: '0'};

/** A repository with history, as a script would usually find one. */
const committedRepo = () => {
	const repo = gitRepo();
	fs.writeFileSync(path.join(repo, 'readme.md'), 'hi');
	git(repo, 'add .');
	git(repo, 'commit -qm first');
	git(repo, 'commit -q --allow-empty -m second');
	return repo;
};

const worktreeCount = (repo: string) =>
	git(repo, 'worktree list --porcelain').split('\n\n').length;

const projectIdOn = (repo: string, ref: string) =>
	(
		JSON.parse(git(repo, `show ${ref}:.epiq/project.json`)) as {
			projectId: string;
		}
	).projectId;

/** A board started on a side branch, then main checked out again: no project file. */
const boardOnAnotherBranch = () => {
	const repo = committedRepo();
	const main = git(repo, 'rev-parse --abbrev-ref HEAD');
	git(repo, 'checkout -qb side');
	expect(runInit(repo).status).toBe(0);
	git(repo, `checkout -q ${main}`);
	expect(fs.existsSync(path.join(repo, '.epiq/project.json'))).toBe(false);
	return repo;
};

describe('epiq init', () => {
	it(
		'without an author, refuses and writes nothing',
		() => {
			const repo = gitRepo();

			const {status, output} = runInit(repo);

			expect(status).toBe(1);
			expect(output).toContain('epiq setup');
			expect(gitFootprint(repo)).toEqual(EMPTY);
		},
		testTimeout,
	);

	it(
		'refuses an author the environment names badly, and writes nothing',
		() => {
			const repo = gitRepo();

			expect(runInit(repo, {EPIQ_USER_NAME: 'x'.repeat(200)}).status).toBe(1);
			expect(runInit(repo, {EPIQ_USER_ID: 'ID'}).status).toBe(1);
			expect(gitFootprint(repo)).toEqual(EMPTY);
		},
		testTimeout,
	);

	it(
		'outside a git repository, refuses and writes nothing',
		() => {
			const dir = tempDir();

			const {status} = runInit(dir, {EPIQ_USER_NAME: 'script'});

			expect(status).toBe(1);
			expect(fs.existsSync(path.join(dir, '.epiq'))).toBe(false);
		},
		testTimeout,
	);

	it(
		'with uncommitted files, refuses and writes nothing',
		() => {
			const repo = gitRepo();
			fs.writeFileSync(path.join(repo, 'notes.txt'), 'draft');

			const {status} = runInit(repo, {EPIQ_USER_NAME: 'script'});

			expect(status).toBe(1);
			expect(gitFootprint(repo)).toEqual(EMPTY);
		},
		testTimeout,
	);

	it(
		'an environment actor starts a board on a machine never set up; the TUI then asks setup, not init',
		async () => {
			const repo = gitRepo();

			const {status, output} = runInit(repo, {EPIQ_USER_NAME: 'script'});

			expect(output).toContain('Project initialized');
			expect(status).toBe(0);
			expect(fs.existsSync(path.join(repo, '.epiq/project.json'))).toBe(true);

			const tui = setupTui([], {cwd: repo});
			try {
				const frame = await tui.waitFor(
					'the name others see on the board',
					20_000,
				);
				expect(frame).not.toContain('Do you want to start one here?');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'half a setup is author enough; the TUI then asks the rest, not init',
		async () => {
			const setup = setupTui([], {cwd: tempDir()});
			try {
				await setup.waitFor('the name others see on the board', 20_000);
				await typeCommand(setup, ':config username test');
				await setup.waitFor('Auto sync keeps the board current', 20_000);
			} finally {
				await setup.destroy();
			}

			const repo = gitRepo();
			const {status} = runInit(repo);
			expect(status).toBe(0);

			const tui = setupTui([], {cwd: repo});
			try {
				const frame = await tui.waitFor(
					'Auto sync keeps the board current',
					20_000,
				);
				expect(frame).not.toContain('Do you want to start one here?');

				await typeCommand(tui, ':config autoSync off');
				await commonSteps.declineEmails(tui);
				await tui.waitFor('Todo (0)', 20_000);
			} finally {
				await tui.destroy();
			}

			// Twice is refused, and the refusal changes nothing.
			const before = gitFootprint(repo);
			const again = runInit(repo);
			expect(again.status).toBe(1);
			expect(again.output).toContain('already initialized');
			expect(gitFootprint(repo)).toEqual(before);
		},
		testTimeout,
	);

	it(
		'from a subdirectory, starts the board at the repository root',
		() => {
			const repo = gitRepo();
			const sub = path.join(repo, 'packages', 'app');
			fs.mkdirSync(sub, {recursive: true});

			const {status} = runInit(sub);

			expect(status).toBe(0);
			expect(fs.existsSync(path.join(repo, '.epiq/project.json'))).toBe(true);
			expect(fs.existsSync(path.join(sub, '.epiq'))).toBe(false);
		},
		testTimeout,
	);

	it(
		'refuses a stray argument and a detached HEAD, and writes nothing',
		() => {
			const repo = committedRepo();
			const before = gitFootprint(repo);

			const stray = runInit(repo, {}, ['init', 'packages']);
			expect(stray.status).toBe(1);
			expect(stray.output).toContain('Unexpected argument: packages');

			git(repo, 'checkout -q HEAD~1');
			const detached = runInit(repo);
			expect(detached.status).toBe(1);
			expect(detached.output).toContain('HEAD is detached');

			expect(gitFootprint(repo)).toEqual(before);
		},
		testTimeout,
	);

	it(
		'a commit that fails halfway takes the half board back, so the retry starts it',
		() => {
			const repo = committedRepo();
			const before = gitFootprint(repo);
			// Signing that fails, as with a locked key agent.
			git(repo, 'config commit.gpgsign true');
			git(repo, 'config gpg.program false');

			const failed = runInit(repo);
			expect(failed.status).toBe(1);
			expect(gitFootprint(repo)).toEqual(before);
			expect(git(repo, 'status --porcelain')).toBe('');
			expect(worktreeCount(repo)).toBe(1);

			git(repo, 'config commit.gpgsign false');
			expect(runInit(repo).status).toBe(0);
		},
		testTimeout,
	);

	it(
		"an empty state branch, left by an older version's failed init, does not block init",
		() => {
			const repo = committedRepo();
			// Dated well back: one created moments ago may be another init's, mid-run.
			const empty = execSync(
				'git commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -m aborted',
				{
					cwd: repo,
					encoding: 'utf8',
					env: {...process.env, GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'},
				},
			).trim();
			git(repo, `update-ref refs/heads/__epiq_state__ ${empty}`);

			const {status, output} = runInit(repo);

			expect(output).toContain('Project initialized');
			expect(status).toBe(0);
			expect(git(repo, 'rev-list --count __epiq_state__')).not.toBe('1');
		},
		testTimeout,
	);

	it(
		'an empty state branch made moments ago is left alone: another init may own it',
		() => {
			const repo = committedRepo();
			const empty = git(
				repo,
				'commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -m running',
			);
			git(repo, `update-ref refs/heads/__epiq_state__ ${empty}`);
			const before = gitFootprint(repo);

			const {status, output} = runInit(repo);

			expect(status).toBe(1);
			expect(output).toContain('another init may be running');
			expect(gitFootprint(repo)).toEqual(before);
		},
		testTimeout,
	);

	it(
		'a failed init puts back a .gitignore that git itself ignores',
		() => {
			const repo = committedRepo();
			fs.writeFileSync(path.join(repo, '.git/info/exclude'), '.gitignore\n');
			fs.writeFileSync(path.join(repo, '.gitignore'), 'mine\n');
			// Init then fails on its own: git refuses to stage an ignored file.

			expect(runInit(repo).status).toBe(1);
			expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe(
				'mine\n',
			);
			expect(fs.existsSync(path.join(repo, '.epiq/project.json'))).toBe(false);
		},
		testTimeout,
	);

	it(
		'a board started on another branch is adopted, not minted again',
		() => {
			const repo = boardOnAnotherBranch();

			const {status} = runInit(repo);

			expect(status).toBe(0);
			expect(projectIdOn(repo, 'HEAD')).toBe(projectIdOn(repo, 'side'));
			expect(git(repo, 'status --porcelain')).toBe('');
		},
		testTimeout,
	);

	it(
		"the TUI's offer adopts a board started on another branch, and shows it",
		async () => {
			const repo = boardOnAnotherBranch();

			const tui = setupTui([], {cwd: repo});
			try {
				await tui.waitFor('Do you want to start one here?', 20_000);
				tui.input(ENTER);
				// The board's own question, as on any board in a repository with history.
				await tui.waitFor('Claim yours by address', 20_000);
				await commonSteps.declineEmails(tui);
				await tui.waitFor('Default (0 issues)', 20_000);
			} finally {
				await tui.destroy();
			}

			expect(projectIdOn(repo, 'HEAD')).toBe(projectIdOn(repo, 'side'));
		},
		testTimeout,
	);
});
