import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	getCommitsForRef,
	getCommitTimeline,
	resetCommitTimelineCacheForTests,
} from '../lib/commits/commits.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {makeTempDir} from './helpers/git-repo.js';

// Real git log output from the board's own repo, read the way every source is.

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const commit = (cwd: string, author: string, message: string[]) =>
	childProcess.execFileSync(
		'git',
		['commit', '-q', '--allow-empty', ...message.flatMap(part => ['-m', part])],
		{
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: author,
				GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@example.com`,
				GIT_COMMITTER_NAME: author,
				GIT_COMMITTER_EMAIL: `${author.toLowerCase()}@example.com`,
			},
		},
	);

let board: string;

beforeEach(() => {
	resetCommitTimelineCacheForTests();

	board = makeTempDir();
	childProcess.execFileSync('git', ['init', '-q', '-b', 'main'], {cwd: board});
	fs.mkdirSync(path.join(board, '.epiq'), {recursive: true});
	fs.writeFileSync(
		path.join(board, '.epiq', 'project.json'),
		JSON.stringify({
			projectId: path.basename(board),
			stateBranch: 'epiq/state',
			createdAt: '2020-01-01T00:00:00.000Z',
		}) + '\n',
	);
	commit(board, 'Ada', ['init']);
	childProcess.execFileSync('git', ['branch', 'epiq/state'], {cwd: board});
});

afterEach(() => {
	resetCommitTimelineCacheForTests();
});

describe("the board's own repo", () => {
	// A field opening with the letter a marker is spelled with must not be
	// taken for one: an author "Erik", a subject starting "B" or "E".
	it('reads fields that start like a marker, and the refs in bodies', async () => {
		commit(board, 'Erik', ['pin the tag', 'Epiq-Ref: B8PYTCM']);
		commit(board, 'Ada', ['Bump the floor', 'Epiq-Ref: W1TCS14, B8PYTCM']);
		commit(board, 'Bea', ['Enable the timer']);

		const timeline = value(await getCommitTimeline({repoRoot: board}));

		expect(
			timeline.map(({author, subject, refs}) => ({author, subject, refs})),
		).toEqual([
			{author: 'Bea', subject: 'Enable the timer', refs: undefined},
			{
				author: 'Ada',
				subject: 'Bump the floor',
				refs: ['W1TCS14', 'B8PYTCM'],
			},
			{author: 'Erik', subject: 'pin the tag', refs: ['B8PYTCM']},
		]);

		const linked = value(
			await getCommitsForRef({repoRoot: board, ref: 'B8PYTCM'}),
		);
		expect(linked.map(entry => entry.subject)).toEqual([
			'Bump the floor',
			'pin the tag',
		]);
	});

	it('still links a commit by a ref-prefixed subject', async () => {
		commit(board, 'Erik', ['B8PYTCM pin the tag']);

		const linked = value(
			await getCommitsForRef({repoRoot: board, ref: 'B8PYTCM'}),
		);
		expect(linked.map(entry => entry.author)).toEqual(['Erik']);
	});
});
