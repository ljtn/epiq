import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {git} from '../git/git-commands.js';
import {ensureInitialCommit, INITIAL_COMMIT_MESSAGE} from '../git/git.js';
import {GIT_BIN} from '../git/git-utils.js';
import {isFail} from '../lib/model/result-types.js';

// epiq writes commits in the user's own repository in exactly one place, and
// that repository may hold unrelated or confidential work. These tests assert
// the guarantees that make that safe, against real repositories.

const created: string[] = [];

const gitIn = (repo: string, args: string[]): string =>
	execFileSync(GIT_BIN, args, {cwd: repo, encoding: 'utf8'}).trim();

const makeRepo = (): string => {
	const repo = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-git-safety-')),
	);

	// A test that escaped the temp directory would operate on a real
	// repository. Refuse rather than find out afterwards.
	if (!repo.startsWith(fs.realpathSync(os.tmpdir()))) {
		throw new Error(`Refusing to test outside the temp dir: ${repo}`);
	}

	created.push(repo);
	gitIn(repo, ['init', '-q', '--initial-branch=main', '.']);
	gitIn(repo, ['config', 'user.name', 'Test']);
	gitIn(repo, ['config', 'user.email', 'test@example.com']);

	return repo;
};

const commitCount = (repo: string): number => {
	try {
		return Number(gitIn(repo, ['rev-list', '--count', 'HEAD']));
	} catch {
		return 0;
	}
};

const stagedFiles = (repo: string): string[] =>
	gitIn(repo, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);

const filesInHead = (repo: string): string[] =>
	gitIn(repo, ['show', '--pretty=format:', '--name-only', 'HEAD'])
		.split('\n')
		.filter(Boolean);

const write = (repo: string, name: string, body: string): void => {
	fs.mkdirSync(path.dirname(path.join(repo, name)), {recursive: true});
	fs.writeFileSync(path.join(repo, name), body);
};

afterEach(() => {
	while (created.length) {
		fs.rmSync(created.pop()!, {recursive: true, force: true});
	}
});

describe('ensureInitialCommit', () => {
	it('creates the one commit a branch needs when the repo has none', async () => {
		const repo = makeRepo();

		const result = await ensureInitialCommit(repo);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toBe(true);
		expect(commitCount(repo)).toBe(1);
		expect(gitIn(repo, ['log', '-1', '--format=%s'])).toBe(
			INITIAL_COMMIT_MESSAGE,
		);
	});

	it('creates a commit that contains no files at all', async () => {
		const repo = makeRepo();
		write(repo, 'notes.txt', 'unrelated');
		gitIn(repo, ['add', 'notes.txt']);

		await ensureInitialCommit(repo);

		expect(filesInHead(repo)).toEqual([]);
	});

	// The incident this was written for: a commit swept 17 staged files of
	// unrelated work into a repo epiq does not own.
	it('leaves staged work staged and uncommitted', async () => {
		const repo = makeRepo();
		write(repo, 'secret.txt', 'nuclear codes');
		write(repo, 'src/app.ts', 'export const x = 1;');
		gitIn(repo, ['add', 'secret.txt', 'src/app.ts']);

		await ensureInitialCommit(repo);

		expect(stagedFiles(repo)).toEqual(['secret.txt', 'src/app.ts']);
		expect(filesInHead(repo)).toEqual([]);
		expect(fs.readFileSync(path.join(repo, 'secret.txt'), 'utf8')).toBe(
			'nuclear codes',
		);
	});

	it('leaves untracked and modified files alone', async () => {
		const repo = makeRepo();
		write(repo, 'untracked.txt', 'mine');

		await ensureInitialCommit(repo);

		expect(gitIn(repo, ['status', '--porcelain'])).toBe('?? untracked.txt');
	});

	it('does nothing when the repo already has commits', async () => {
		const repo = makeRepo();
		write(repo, 'a.txt', 'a');
		gitIn(repo, ['add', 'a.txt']);
		gitIn(repo, ['commit', '-q', '-m', 'real work']);
		const before = gitIn(repo, ['rev-parse', 'HEAD']);

		const result = await ensureInitialCommit(repo);

		expect(isFail(result)).toBe(false);
		if (isFail(result)) return;
		expect(result.value).toBe(false);
		expect(gitIn(repo, ['rev-parse', 'HEAD'])).toBe(before);
		expect(commitCount(repo)).toBe(1);
	});

	it('does not disturb staged work when the repo already has commits', async () => {
		const repo = makeRepo();
		write(repo, 'a.txt', 'a');
		gitIn(repo, ['add', 'a.txt']);
		gitIn(repo, ['commit', '-q', '-m', 'real work']);
		write(repo, 'wip.txt', 'in progress');
		gitIn(repo, ['add', 'wip.txt']);

		await ensureInitialCommit(repo);

		expect(stagedFiles(repo)).toEqual(['wip.txt']);
		expect(commitCount(repo)).toBe(1);
	});

	// `rev-parse --verify HEAD` exits non-zero for an unborn HEAD *and* for a
	// command that simply failed. Guessing wrong writes in someone's repo.
	it('fails closed when it cannot tell whether the repo has commits', async () => {
		const missing = path.join(os.tmpdir(), 'epiq-git-safety-does-not-exist');

		const result = await ensureInitialCommit(missing);

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('nothing was written');
	});

	it('writes nothing to a directory that is not a git repository', async () => {
		const notARepo = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-git-safety-plain-')),
		);
		created.push(notARepo);
		write(notARepo, 'file.txt', 'contents');

		const result = await ensureInitialCommit(notARepo);

		expect(isFail(result)).toBe(true);
		expect(fs.existsSync(path.join(notARepo, '.git'))).toBe(false);
		expect(fs.readdirSync(notARepo)).toEqual(['file.txt']);
	});
});

describe('git.commit pathspec', () => {
	it('commits only the named paths, leaving other staged work staged', async () => {
		const repo = makeRepo();
		write(repo, 'seed.txt', 'seed');
		gitIn(repo, ['add', 'seed.txt']);
		gitIn(repo, ['commit', '-q', '-m', 'seed']);

		write(repo, '.epiq/project.json', '{}');
		write(repo, '.gitignore', 'node_modules\n');
		write(repo, 'secret.txt', 'not ours to commit');
		gitIn(repo, ['add', '.epiq/project.json', '.gitignore', 'secret.txt']);

		const result = await git.commit({
			cwd: repo,
			message: '[epiq:init-project]',
			pathspec: ['.epiq/project.json', '.gitignore'],
		});

		expect(isFail(result)).toBe(false);
		expect(filesInHead(repo).sort()).toEqual([
			'.epiq/project.json',
			'.gitignore',
		]);
		expect(stagedFiles(repo)).toEqual(['secret.txt']);
	});

	// Documents why the pathspec is not optional at the call sites that write
	// in the user's repository.
	it('takes everything staged when no pathspec is given', async () => {
		const repo = makeRepo();
		write(repo, 'seed.txt', 'seed');
		gitIn(repo, ['add', 'seed.txt']);
		gitIn(repo, ['commit', '-q', '-m', 'seed']);

		write(repo, 'ours.txt', 'ours');
		write(repo, 'theirs.txt', 'theirs');
		gitIn(repo, ['add', 'ours.txt', 'theirs.txt']);

		await git.commit({cwd: repo, message: 'no pathspec'});

		expect(filesInHead(repo).sort()).toEqual(['ours.txt', 'theirs.txt']);
	});
});

// A guard against the whole class rather than the one instance: the incident
// happened because a commit against the user's repo was reachable from the
// 15-second autosync loop.
describe('no commit reaches the user repository outside init', () => {
	const sourceRoot = path.join(process.cwd(), 'source');

	const sourceFiles = (dir: string): string[] =>
		fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				// The claim is about shipped code. Test helpers drive git against
				// throwaway repos and are not `.test.` files, so without this they
				// read as offenders.
				return entry.name === 'node_modules' || entry.name === 'test'
					? []
					: sourceFiles(full);
			}
			return entry.name.endsWith('.ts') && !entry.name.includes('.test.')
				? [full]
				: [];
		});

	it('only init-project.ts commits with cwd: repoRoot', () => {
		const offenders = sourceFiles(sourceRoot).filter(file => {
			const body = fs.readFileSync(file, 'utf8');

			return [...body.matchAll(/(?:git\.commit|commitAndGetSha)\(\{/g)].some(
				match => {
					const call = body.slice(match.index, match.index + 260);
					const end = call.indexOf('});');
					return (end === -1 ? call : call.slice(0, end)).includes(
						'cwd: repoRoot',
					);
				},
			);
		});

		expect(offenders.map(file => path.relative(sourceRoot, file))).toEqual([
			'lib/project-setup/init-project.ts',
		]);
	});

	it('only init-project.ts stages with cwd: repoRoot', () => {
		const offenders = sourceFiles(sourceRoot).filter(file => {
			const body = fs.readFileSync(file, 'utf8');

			return [...body.matchAll(/git\.stage\(\{/g)].some(match => {
				const call = body.slice(match.index, match.index + 200);
				const end = call.indexOf('});');
				return (end === -1 ? call : call.slice(0, end)).includes(
					'cwd: repoRoot',
				);
			});
		});

		expect(offenders.map(file => path.relative(sourceRoot, file))).toEqual([
			'lib/project-setup/init-project.ts',
		]);
	});

	// Pushing from the user's repo pushes their branch, not ours. Init does it
	// once, by request; nothing else may acquire the habit.
	it('only init-project.ts pushes from the user repository', () => {
		const offenders = sourceFiles(sourceRoot).filter(file => {
			const body = fs.readFileSync(file, 'utf8');

			return [...body.matchAll(/'push'/g)].some(match => {
				const window = body.slice(
					Math.max(0, match.index - 200),
					match.index + 200,
				);
				return window.includes('cwd: repoRoot');
			});
		});

		expect(offenders.map(file => path.relative(sourceRoot, file))).toEqual([
			'lib/project-setup/init-project.ts',
		]);
	});

	it('the sync path does not reference ensureInitialCommit', () => {
		const sync = fs.readFileSync(path.join(sourceRoot, 'git/sync.ts'), 'utf8');

		expect(sync).not.toContain('ensureInitialCommit');
	});
});
