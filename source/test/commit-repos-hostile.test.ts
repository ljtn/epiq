import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	fetchCommitRepos,
	getCommitDiff,
	getCommitsForRef,
	listRepoStates,
	readCommitRepos,
	repoIdOf,
	repoUrlProblem,
	resetCommitTimelineCacheForTests,
	trustRepo,
	upsertCommitRepo,
} from '../lib/commits/commits.js';
import {
	getRepoClonePath,
	getRepoClonesDir,
	MAX_REPOS,
} from '../lib/commits/commit-repos.js';
import {execGit} from '../git/git-utils.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {addRepo, listRepos} from '../mcp/api/repos.js';
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

describe('a repo nobody here approved', () => {
	it('is listed but never fetched', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		// As a teammate's commit would bring it: in the file, not added here.
		writeProject(board, {repos: [url]});

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome).toMatchObject({ok: true, awaitingApproval: true});
		expect(fs.existsSync(getRepoClonePath(PROJECT_ID, repoIdOf(url)))).toBe(
			false,
		);
		expect(value(listRepoStates(board))[0]).toMatchObject({
			trusted: false,
			cloned: false,
		});
	});

	it('is fetched once approved here', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		writeProject(board, {repos: [url]});

		const [repo] = value(readCommitRepos(board));
		value(trustRepo(board, repo!));
		value(await fetchCommitRepos({repoRoot: board}));

		expect(
			value(await getCommitsForRef({repoRoot: board, ref: 'AAAAAAA'})),
		).toHaveLength(1);
	});

	it('gets no approval from another URL that shares its id', async () => {
		writeProject(board, {repos: [url]});
		const id = repoIdOf(url);

		// What a crafted collision would leave: this id approved, for a
		// different URL than the one now listed.
		fs.mkdirSync(getRepoClonesDir(PROJECT_ID), {recursive: true});
		fs.writeFileSync(
			path.join(getRepoClonesDir(PROJECT_ID), 'trusted.json'),
			JSON.stringify({[id]: 'https://example.com/the-one-approved'}),
		);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));
		expect(outcome).toMatchObject({awaitingApproval: true});
	});

	it('is not approved by an agent adding it over MCP', async () => {
		value(await addRepo({repoRoot: board, url}));

		expect(value(await listRepos({repoRoot: board}))[0]).toMatchObject({
			trusted: false,
		});
	});

	it('is approved by a person adding it from the GUI', async () => {
		value(await addRepo({repoRoot: board, url, trust: true}));

		expect(value(await listRepos({repoRoot: board}))[0]).toMatchObject({
			trusted: true,
		});
	});
});

describe('a clone that no longer matches the list', () => {
	it('is not fetched from wherever it now points', async () => {
		commit(upstream, 'up.txt', 'AAAAAAA upstream');
		value(upsertCommitRepo({repoRoot: board, url, trust: true}));
		value(await fetchCommitRepos({repoRoot: board}));

		const clonePath = getRepoClonePath(PROJECT_ID, repoIdOf(url));
		git(clonePath, [
			'--git-dir=.',
			'config',
			'remote.origin.url',
			'https://example.com/elsewhere.git',
		]);

		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));
		expect(outcome!.ok).toBe(false);
		expect(outcome!.message).toMatch(/another URL/);
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
		value(upsertCommitRepo({repoRoot: board, url, trust: true}));
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
		value(upsertCommitRepo({repoRoot: board, url, trust: true}));
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
