import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {withoutRepositoryOverrides} from '../git/git-utils.js';
import {acquireLockFile} from '../git/sync-lock.js';
import {parseRepoAddArgs} from '../lib/command-line/commands/repo.cmd.js';
import {
	findCommitRepo,
	isRepoSince,
	removableNames,
	repoIdOf,
	repoLabelOfId,
} from '../lib/commits/commit-repos.js';
import {isFail} from '../lib/model/result-types.js';
import {parseGuiMessage} from '../gui/api/lib/websocket.schema.js';
import {
	commitRepoKeys,
	effectiveHidden,
	OWN_REPO,
	withoutHiddenRepos,
} from '../gui/client/lib/commit-repo-filter.js';
import {GuiCommitEntry} from '../gui/client/lib/gui-state.model.js';
import {repoLabelOf} from '../gui/client/lib/repo-label.js';

describe('a history window', () => {
	it.each(['board', 'all', '2024-02-29', '1970-01-01'])('takes %s', since => {
		expect(isRepoSince(since)).toBe(true);
	});

	it.each(['2025-02-30', '2023-02-29', '2024-13-01', '1969-12-31', 'today'])(
		'refuses %s',
		since => {
			expect(isRepoSince(since)).toBe(false);
		},
	);
});

describe(':config repoAdd arguments', () => {
	it('names the options it takes when given one it does not', () => {
		const result = parseRepoAddArgs(
			'https://example.com/a/b.git since=2025-02-30',
		);

		expect(isFail(result) ? result.message : '').toMatch(
			/^branches=default, .*; not "since=2025-02-30"$/,
		);
	});

	it('takes a URL alone, with the defaults left to the config', () => {
		const result = parseRepoAddArgs('  https://example.com/a/b.git ');

		expect(isFail(result) ? null : result.value).toEqual({
			url: 'https://example.com/a/b.git',
		});
	});

	it('takes the options after it, in any order', () => {
		const result = parseRepoAddArgs(
			'git@example.com:a/b.git since=2024-05-01 branches=all',
		);

		expect(isFail(result) ? null : result.value).toEqual({
			url: 'git@example.com:a/b.git',
			branches: 'all',
			since: '2024-05-01',
		});
	});

	it('refuses a label with a second =, rather than keeping its first half, and an option said twice', () => {
		expect(
			isFail(parseRepoAddArgs('https://example.com/a.git label=a=b')),
		).toBe(true);
		expect(
			isFail(parseRepoAddArgs('https://example.com/a.git label=a label=b')),
		).toBe(true);
	});

	it('refuses a local path, a flag, and an option it does not know', () => {
		expect(isFail(parseRepoAddArgs('/home/me/src/thing'))).toBe(true);
		expect(isFail(parseRepoAddArgs('--upload-pack=x'))).toBe(true);
		expect(isFail(parseRepoAddArgs('https://example.com/a.git depth=1'))).toBe(
			true,
		);
		expect(
			isFail(parseRepoAddArgs('https://example.com/a.git since=yesterday')),
		).toBe(true);
	});
});

describe('a repo id read back as its label', () => {
	it('is the same on the server and in the browser', () => {
		for (const url of [
			'https://example.com/a/fancy-project.git',
			'git@example.com:a/b.c.git',
			'file:///tmp/x/y',
		]) {
			const id = repoIdOf(url);
			expect(repoLabelOf(id)).toBe(repoLabelOfId(id));
			expect(repoLabelOf(id)).not.toMatch(/-[0-9a-f]{12}$/);
		}
	});
});

const commit = (sha: string, repo?: string): GuiCommitEntry => ({
	sha,
	...(repo ? {repo} : {}),
	time: 0,
	author: 'a',
	authorEmail: 'a@example.com',
	subject: sha,
	linesChanged: 0,
	insertions: 0,
	deletions: 0,
});

describe('which repos the Code series plots', () => {
	const commits = [
		commit('1', 'zed-00000000'),
		commit('2'),
		commit('3', 'abc-11111111'),
	];

	it('lists the board’s own repo first', () => {
		expect(commitRepoKeys(commits)).toEqual([
			OWN_REPO,
			'abc-11111111',
			'zed-00000000',
		]);
	});

	it('hands the same array back while nothing is hidden', () => {
		expect(withoutHiddenRepos(commits, new Set())).toBe(commits);
	});

	it('drops a hidden repo’s commits, the board’s own included', () => {
		expect(
			withoutHiddenRepos(commits, new Set([OWN_REPO, 'zed-00000000'])).map(
				entry => entry.sha,
			),
		).toEqual(['3']);
	});
});

describe('the repo messages on the GUI socket', () => {
	it('accepts the repo a diff is asked of, and drops a smuggled repoRoot', () => {
		const parsed = parseGuiMessage({
			type: 'commit:diff:get',
			payload: {sha: 'abc1234', repo: 'x-00000000', repoRoot: '/elsewhere'},
		});

		expect(parsed.ok && parsed.message).toEqual({
			type: 'commit:diff:get',
			payload: {sha: 'abc1234', repo: 'x-00000000'},
		});
	});

	it('refuses a branches value it does not know', () => {
		expect(
			parseGuiMessage({
				type: 'repo:add',
				payload: {url: 'https://example.com/a.git', branches: 'some'},
			}).ok,
		).toBe(false);
	});

	it('takes the bare reads', () => {
		expect(parseGuiMessage({type: 'repos:get'}).ok).toBe(true);
		// Fetching is the sync's; the panel has no message for it.
		expect(parseGuiMessage({type: 'repos:fetch'}).ok).toBe(false);
	});
});

describe(':config repoRemove names', () => {
	const repos = [
		'https://a.example/x/api.git',
		'https://b.example/y/api.git',
		'https://c.example/web.git',
	].map(url => ({
		url,
		id: repoIdOf(url),
		label: repoLabelOfId(repoIdOf(url)),
		branches: 'default' as const,
		since: 'board',
	}));

	it('offers a shared label by id, and a unique one by label', () => {
		expect(removableNames(repos)).toEqual([repos[0]!.id, repos[1]!.id, 'web']);
	});

	it('refuses a label two repos share, and takes the id or the URL instead', () => {
		expect(isFail(findCommitRepo(repos, 'api'))).toBe(true);
		expect(findCommitRepo(repos, repos[1]!.id)).toMatchObject({
			value: repos[1],
		});
		expect(findCommitRepo(repos, 'https://b.example/y/api.git')).toMatchObject({
			value: repos[1],
		});
		expect(findCommitRepo(repos, 'web')).toMatchObject({value: repos[2]});
	});
});

describe('a lock file for long work', () => {
	it('is not broken at the sync lock’s age while its holder lives', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-lock-'));
		const lockPath = path.join(dir, 'x.lock');
		fs.writeFileSync(
			lockPath,
			JSON.stringify({
				pid: process.pid,
				hostname: os.hostname(),
				startedAt: Date.now() - 20 * 60 * 1000,
				operation: 'fetch',
			}),
		);

		expect(
			acquireLockFile({
				lockPath,
				operation: 'fetch',
				staleAfterMs: 60 * 60 * 1000,
			}).acquired,
		).toBe(false);
		expect(acquireLockFile({lockPath, operation: 'fetch'}).acquired).toBe(true);

		fs.rmSync(dir, {recursive: true, force: true});
	});
});

describe('the environment git is started with', () => {
	// A process started from a git hook inherits these, and every call here
	// names its repository by its working directory.
	it('drops what would point git at another repository', () => {
		expect(
			withoutRepositoryOverrides({
				PATH: '/usr/bin',
				GIT_DIR: '/elsewhere/.git',
				GIT_WORK_TREE: '/elsewhere',
				GIT_INDEX_FILE: '/elsewhere/.git/index',
				GIT_OBJECT_DIRECTORY: '/elsewhere/.git/objects',
				GIT_ALTERNATE_OBJECT_DIRECTORIES: '/elsewhere/.git/objects',
				GIT_COMMON_DIR: '/elsewhere/.git',
				GIT_NAMESPACE: 'x',
				GIT_SSH_COMMAND: 'ssh',
			}),
		).toEqual({PATH: '/usr/bin', GIT_SSH_COMMAND: 'ssh'});
	});
});

describe('a repo hidden from the Code series', () => {
	it('is shown again once its toggle is not drawn', () => {
		// Hidden while two repos were on offer; the window now holds one.
		expect(effectiveHidden([OWN_REPO], new Set([OWN_REPO])).size).toBe(0);
	});

	it('stays hidden while its toggle is on screen, and only it', () => {
		expect([
			...effectiveHidden(
				[OWN_REPO, 'abc-111111111111'],
				new Set([OWN_REPO, 'gone-222222222222']),
			),
		]).toEqual([OWN_REPO]);
	});
});

describe(':config repoAdd label', () => {
	it('takes a label, and an empty one to go back to the basename', () => {
		const named = parseRepoAddArgs('https://example.com/a.git label=upstream');
		expect(isFail(named) ? null : named.value).toEqual({
			url: 'https://example.com/a.git',
			label: 'upstream',
		});

		const cleared = parseRepoAddArgs('https://example.com/a.git label=');
		expect(isFail(cleared) ? null : cleared.value).toEqual({
			url: 'https://example.com/a.git',
			label: '',
		});
	});

	it('refuses what is not a label', () => {
		expect(isFail(parseRepoAddArgs('https://example.com/a.git label=UP'))).toBe(
			true,
		);
		expect(isFail(parseRepoAddArgs('https://example.com/a.git label=.x'))).toBe(
			true,
		);
	});
});

describe('repo:add over the socket with a label', () => {
	it('takes one up to 24 characters', () => {
		const url = 'https://example.com/a.git';
		expect(
			parseGuiMessage({type: 'repo:add', payload: {url, label: 'upstream'}}).ok,
		).toBe(true);
		expect(
			parseGuiMessage({type: 'repo:add', payload: {url, label: ''}}).ok,
		).toBe(true);
		expect(
			parseGuiMessage({type: 'repo:add', payload: {url, label: 'x'.repeat(25)}})
				.ok,
		).toBe(false);
	});
});
