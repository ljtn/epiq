import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	fetchCommitRepos,
	getCommitDiff,
	getCommitsForRef,
	readCommitRepos,
	repoIdOf,
	repoUrlProblem,
	resetCommitTimelineCacheForTests,
	upsertCommitRepo,
} from '../lib/commits/commits.js';
import {getRepoClonePath, MAX_REPOS} from '../lib/commits/commit-repos.js';
import {execGit} from '../git/git-utils.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {makeTempDir} from './helpers/git-repo.js';

// `project.json` arrives with the code, so its repo list is anybody's who can
// land a commit; and a registered repo's contents are its owner's, not ours.

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const git = (cwd: string, args: string[]) =>
	childProcess
		.execFileSync('git', args, {
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
			},
		})
		.toString();

const commit = (
	cwd: string,
	file: string,
	message: string,
	content?: string,
) => {
	fs.writeFileSync(path.join(cwd, file), content ?? `${message}\n`);
	git(cwd, ['add', file]);
	git(cwd, ['commit', '-q', '-m', message]);
	return git(cwd, ['rev-parse', 'HEAD']).trim();
};

const PROJECT_ID = 'hostile-board';

const writeProject = (root: string, extra: Record<string, unknown> = {}) => {
	fs.mkdirSync(path.join(root, '.epiq'), {recursive: true});
	fs.writeFileSync(
		path.join(root, '.epiq', 'project.json'),
		JSON.stringify(
			{
				projectId: PROJECT_ID,
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
				...extra,
			},
			null,
			2,
		) + '\n',
	);
};

let board: string;
let upstream: string;
let url: string;

beforeEach(() => {
	resetCommitTimelineCacheForTests();

	board = makeTempDir();
	git(board, ['init', '-q', '-b', 'main']);
	writeProject(board);
	commit(board, 'init.txt', 'init');
	git(board, ['branch', 'epiq/state']);

	upstream = makeTempDir();
	git(upstream, ['init', '-q', '-b', 'main']);
	commit(upstream, 'init.txt', 'init');
	url = `file://${upstream}`;
});

afterEach(() => {
	resetCommitTimelineCacheForTests();
});

describe('a URL from a committed file', () => {
	it.each([
		['ext::sh -c touch% /tmp/pwned', 'runs a command'],
		['fd::17', 'reads a descriptor'],
		['--upload-pack=touch /tmp/pwned', 'is an option'],
		['ssh://-oProxyCommand=touch%20x/repo', 'puts an option in the host'],
		['ssh://-oProxyCommand@host/repo', 'puts an option in the user'],
		['-oProxyCommand=x@host:repo', 'is an scp option'],
		['me@-oProxyCommand=x:repo', 'is an scp host option'],
		['https://user:hunter2@example.com/repo.git', 'commits a password'],
		[
			'https://github.com@evil.example/acme/widgets',
			'passes one host off as another',
		],
		[`https://${'%41'.repeat(300)}@evil.example/x`, 'buries the host'],
		['file://fileserver/share/repo', 'names a host for a file URL'],
		['/home/me/src/repo', 'is a local path'],
		['https://example.com/a repo', 'holds a space'],
		['https://example.com/\x1b]0;pwned\x07', 'holds a control character'],
		['https://exаmple.com/repo', 'hides a lookalike letter'],
		[`https://example.com/${'a'.repeat(3000)}`, 'is far too long'],
		['svn://example.com/repo', 'uses another transport'],
		['file::helper', 'names a remote helper'],
		['https::example.com/repo', 'names a remote helper'],
		['file:relative/path', 'is ssh to a host called file'],
		['file:/etc/repo', 'is not a file:/// URL'],
		['ssh:///repo', 'names no host'],
	])('refuses %j, which %s', bad => {
		expect(repoUrlProblem(bad)).not.toBeNull();
	});

	it.each([
		'https://example.com/a/b.git',
		'http://example.com/a/b.git',
		'ssh://git@example.com:2222/a/b.git',
		'git://example.com/a/b.git',
		'git@example.com:a/b.git',
		'file:///srv/git/b.git',
	])('takes %j', good => {
		expect(repoUrlProblem(good)).toBeNull();
	});

	it('reads no more than the cap, however many are listed', () => {
		writeProject(board, {
			repos: Array.from(
				{length: MAX_REPOS + 30},
				(_, index) => `https://example.com/r${index}.git`,
			),
		});

		expect(value(readCommitRepos(board))).toHaveLength(MAX_REPOS);
	});
});

describe('a clone that no longer matches the list', () => {
	it('is cloned again from the listed URL, never fetched from where it points', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
		git(clonePath, [
			'--git-dir=.',
			'config',
			'remote.origin.url',
			'https://example.com/elsewhere.git',
		]);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			git(clonePath, ['--git-dir=.', 'config', 'remote.origin.url']).trim(),
		).toBe(url);
	});

	it('keeps its clone when the listed URL is only respelled', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
		const marker = path.join(clonePath, 'epiq-test-marker');
		fs.writeFileSync(marker, '');

		writeProject(board, {repos: [`${url}.git/`]});
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(fs.existsSync(marker)).toBe(true);
	});
});

describe('a clone a killed git left behind', () => {
	// A server shut down mid-fetch, or a fetch timed out and killed, leaves
	// git's own lock files; each one would fail every fetch after it.
	it('is fetched again past the locks it left', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
		fs.writeFileSync(path.join(clonePath, 'refs', 'heads', 'main.lock'), '');
		fs.writeFileSync(path.join(clonePath, 'shallow.lock'), '');
		commit(upstream, 'up.txt', 'AAAAAAA second');

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})),
		).toHaveLength(2);
	});
});

describe('a clock and a clone that move under a fetch', () => {
	it('is not held off by a clock set back past the last fetch', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const statusFile = `${getRepoClonePath(PROJECT_ID, repoIdOf(url))}.json`;
		const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
		fs.writeFileSync(
			statusFile,
			JSON.stringify({...status, attemptedAt: Date.now() + 3_600_000}),
		);
		commit(upstream, 'up.txt', 'AAAAAAA second');

		const [outcome] = value(
			await fetchCommitRepos({repoRoot: board, minIntervalMs: 60_000}),
		);
		expect(outcome!.changed).toBe(true);
	});

	it('answers two fetches at once with one, and another process with a skip', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA first');
		value(upsertCommitRepo({repoRoot: board, url}));

		const [first, second] = await Promise.all([
			fetchCommitRepos({repoRoot: board}),
			fetchCommitRepos({repoRoot: board}),
		]);
		// One fetch, answered twice: the very same result.
		expect(second).toBe(first);
		expect(value(first!)[0]!.ok).toBe(true);

		// Another process mid-fetch: its lock, held by a live pid.
		const lockPath = `${getRepoClonePath(PROJECT_ID, repoIdOf(url))}.lock`;
		fs.writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.ppid,
				hostname: os.hostname(),
				startedAt: Date.now(),
				operation: 'fetch',
			}),
		);
		const [skipped] = value(await fetchCommitRepos({repoRoot: board}));
		expect(skipped).toMatchObject({ok: true, message: /Another process/});
		fs.rmSync(lockPath);
	});

	it('reads around a clone deleted underneath it', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));
		commit(board, 'b.txt', 'AAAAAAA board');

		fs.rmSync(getRepoClonePath(PROJECT_ID, repoIdOf(url)), {
			recursive: true,
		});
		resetCommitTimelineCacheForTests();

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
				entry => entry.subject,
			),
		).toEqual(['AAAAAAA board']);
	});

	it('clears a project.json write a dead process left in .epiq/', () => {
		const leftover = path.join(board, '.epiq', 'project.json.2147483646.tmp');
		fs.writeFileSync(leftover, '{');

		value(upsertCommitRepo({repoRoot: board, url}));

		expect(fs.existsSync(leftover)).toBe(false);
		expect(fs.readdirSync(path.join(board, '.epiq'))).toEqual(['project.json']);
	});

	it('keeps a clone directory name short enough for Windows', () => {
		expect(
			repoIdOf(`https://example.com/${'a-very-long-repository-name'.repeat(4)}`)
				.length,
		).toBeLessThanOrEqual(24 + 1 + 12);
	});
});

describe('a remote that renames its default branch', () => {
	it('is followed to the new name rather than failing for good', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA on master-to-be');
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		git(upstream, ['branch', '-m', 'main', 'trunk']);
		commit(upstream, 'up.txt', 'AAAAAAA after the rename');

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})).map(
				entry => entry.subject,
			),
		).toContain('AAAAAAA after the rename');
	});
});

describe('what a registered repo holds', () => {
	it('cannot put a terminal escape in a subject, a name or an address', async () => {
		fs.writeFileSync(path.join(upstream, 'x.txt'), 'x\n');
		git(upstream, ['add', 'x.txt']);
		childProcess.execFileSync(
			'git',
			['commit', '-q', '-m', 'AAAAAAA safe\x1b]0;pwned\x07 ‮subject'],
			{
				cwd: upstream,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: 'Eve\x1b[2J',
					GIT_AUTHOR_EMAIL: 'eve\x07@example.com',
					GIT_COMMITTER_NAME: 'Eve',
					GIT_COMMITTER_EMAIL: 'eve@example.com',
				},
			},
		);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const [entry] = value(
			await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'}),
		);

		for (const text of [entry!.subject, entry!.author, entry!.authorEmail]) {
			expect(text).not.toMatch(/[\x00-\x1f\x7f-\x9f‪-‮]/);
		}
	});

	it('cannot send a file too big to draw across as text', async () => {
		const sha = commit(
			upstream,
			'huge.txt',
			'AAAAAAA a huge file',
			'line\n'.repeat(2 * 1024 * 1024),
		);
		value(upsertCommitRepo({repoRoot: board, url}));
		value(await fetchCommitRepos({repoRoot: board}));

		const diff = value(await getCommitDiff({repoRoot: board, sha}));

		expect(diff.files[0]).toMatchObject({
			path: 'huge.txt',
			isBinary: true,
			after: '',
		});
	});
});

describe('a checkout that looks like a bare repo', () => {
	// A pull request can commit `HEAD`, `objects/` and a `config` of its own at
	// the root; in a checkout named `*.git` that is a bare repository's shape,
	// and treating it as one would run every git call under that config.
	it('is still read through its own .git, not the committed lookalike', async () => {
		const checkout = path.join(makeTempDir(), 'widgets.git');
		fs.mkdirSync(checkout);
		git(checkout, ['init', '-q', '-b', 'main']);
		fs.writeFileSync(path.join(checkout, 'HEAD'), 'ref: refs/heads/main\n');
		fs.mkdirSync(path.join(checkout, 'objects'));
		fs.writeFileSync(path.join(checkout, 'config'), '[core]\n\tbare = true\n');

		const result = value(
			await execGit({cwd: checkout, args: ['rev-parse', '--absolute-git-dir']}),
		);

		expect(fs.realpathSync(result.stdout.trim())).toBe(
			fs.realpathSync(path.join(checkout, '.git')),
		);
	});
});

describe('a project file committed as a link', () => {
	it('is never written through', () => {
		const victim = path.join(makeTempDir(), 'profile');
		fs.writeFileSync(victim, 'export PATH=/usr/bin\n');
		fs.writeFileSync(
			victim,
			JSON.stringify({
				projectId: PROJECT_ID,
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
			}),
		);
		const before = fs.readFileSync(victim, 'utf8');

		const projectFile = path.join(board, '.epiq', 'project.json');
		fs.rmSync(projectFile);
		fs.symlinkSync(victim, projectFile);

		expect(isFail(upsertCommitRepo({repoRoot: board, url}))).toBe(true);
		expect(fs.readFileSync(victim, 'utf8')).toBe(before);
	});

	it('is never written through a linked .epiq directory either', () => {
		const elsewhere = makeTempDir();
		fs.cpSync(path.join(board, '.epiq'), elsewhere, {recursive: true});
		fs.rmSync(path.join(board, '.epiq'), {recursive: true});
		fs.symlinkSync(elsewhere, path.join(board, '.epiq'));
		const before = fs.readFileSync(
			path.join(elsewhere, 'project.json'),
			'utf8',
		);

		expect(isFail(upsertCommitRepo({repoRoot: board, url}))).toBe(true);
		expect(fs.readFileSync(path.join(elsewhere, 'project.json'), 'utf8')).toBe(
			before,
		);
	});
});
