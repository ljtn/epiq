import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {fetchCommitRepos, getCommitDiff} from '../lib/commits/commits.js';
import {PARENT_OUTSIDE_HISTORY} from '../lib/commits/commit-diff.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {repoIdOf} from '../lib/board/board-repos.js';
import {connectRepoEvent} from './helpers/repo-events.js';

// A commit with no parent to diff against: the first one a repository has, and
// the oldest one a clone cut at a date kept, whose parent it never fetched.

const tempDirs: string[] = [];
const makeTempDir = () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-diff-edges-'));
	tempDirs.push(dir);
	return dir;
};

afterAll(() => {
	for (const dir of tempDirs) fs.rmSync(dir, {recursive: true, force: true});
});

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const git = (cwd: string, args: string[], date = '2025-06-01T00:00:00Z') =>
	childProcess
		.execFileSync('git', args, {
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
				GIT_AUTHOR_DATE: date,
				GIT_COMMITTER_DATE: date,
			},
		})
		.toString();

const commit = (cwd: string, file: string, message: string, date?: string) => {
	fs.appendFileSync(path.join(cwd, file), `${message}\n`);
	git(cwd, ['add', file], date);
	git(cwd, ['commit', '-q', '-m', message], date);
	return git(cwd, ['rev-parse', 'HEAD']).trim();
};

const makeBoard = () => {
	const board = makeTempDir();
	git(board, ['init', '-q', '-b', 'main']);
	fs.mkdirSync(path.join(board, '.epiq'));
	fs.writeFileSync(
		path.join(board, '.epiq', 'project.json'),
		JSON.stringify({
			projectId: path.basename(board),
			stateBranch: 'epiq/state',
			createdAt: '2020-01-01T00:00:00.000Z',
		}),
	);
	return board;
};

describe('a commit with no parent here', () => {
	it('diffs a root commit against nothing', async () => {
		const board = makeBoard();
		const root = commit(board, 'first.txt', 'first');

		const diff = value(await getCommitDiff({repoRoot: board, sha: root}));

		expect(diff.files.map(file => file.path)).toEqual(['first.txt']);
	});

	it('says a clone edge has its parent outside the fetched history, rather than showing every file', async () => {
		const board = makeBoard();
		commit(board, 'init.txt', 'init');

		const upstream = makeTempDir();
		git(upstream, ['init', '-q', '-b', 'main']);
		commit(upstream, 'a.txt', 'oldest', '2019-01-01T00:00:00Z');
		const edge = commit(upstream, 'b.txt', 'edge', '2020-01-01T00:00:00Z');
		const inside = commit(upstream, 'c.txt', 'inside', '2025-01-01T00:00:00Z');

		const url = `file://${upstream}`;
		connectRepoEvent(board, url, {since: '2024-01-01'});
		value(await fetchCommitRepos({repoRoot: board}));

		const repo = repoIdOf(url);
		const atEdge = await getCommitDiff({repoRoot: board, sha: edge, repo});
		expect(isFail(atEdge) && atEdge.message).toBe(PARENT_OUTSIDE_HISTORY);

		const diff = value(
			await getCommitDiff({repoRoot: board, sha: inside, repo}),
		);
		expect(diff.files.map(file => file.path)).toEqual(['c.txt']);
	});
});
