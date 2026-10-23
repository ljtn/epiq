import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	getCommitsForRef,
	getSquashedDiffForRef,
	resetCommitTimelineCacheForTests,
} from '../lib/commits/commits.js';
import {isFail, Result} from '../lib/model/result-types.js';
import {getRefDiffTimeline} from '../mcp/api/ref-diff-stats.js';
import {diffStatsAt} from '../gui/client/lib/ref-diff-at.js';
import {makeTempDir} from './helpers/git-repo.js';

// A scrubbed board shows a ticket's code as of its needle: the commits made
// by then, on the card and in the Code tab alike.

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const JAN = Date.parse('2024-01-01T00:00:00Z');
const FEB = Date.parse('2024-02-01T00:00:00Z');
const MID_JAN = Date.parse('2024-01-15T00:00:00Z');

const commitFile = (
	cwd: string,
	file: string,
	lines: number,
	message: string,
	at: number,
) => {
	fs.writeFileSync(
		path.join(cwd, file),
		Array.from({length: lines}, (_, i) => `line ${i}`).join('\n') + '\n',
	);
	const date = new Date(at).toISOString();
	childProcess.execFileSync('git', ['add', file], {cwd});
	childProcess.execFileSync('git', ['commit', '-q', '-m', message], {
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Ada',
			GIT_AUTHOR_EMAIL: 'ada@example.com',
			GIT_COMMITTER_NAME: 'Ada',
			GIT_COMMITTER_EMAIL: 'ada@example.com',
			GIT_AUTHOR_DATE: date,
			GIT_COMMITTER_DATE: date,
		},
	});
};

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
	commitFile(board, 'base.txt', 1, 'init', JAN - 1000);
	childProcess.execFileSync('git', ['branch', 'epiq/state'], {cwd: board});

	commitFile(board, 'early.txt', 3, 'B8PYTCM the early half', JAN);
	commitFile(board, 'late.txt', 5, 'B8PYTCM the late half', FEB);
});

afterEach(() => {
	resetCommitTimelineCacheForTests();
});

describe('a ticket’s code at a cut', () => {
	it('lists only the commits made by the cut', async () => {
		const all = value(
			await getCommitsForRef({repoRoot: board, ref: 'B8PYTCM'}),
		);
		const cut = value(
			await getCommitsForRef({repoRoot: board, ref: 'B8PYTCM', end: MID_JAN}),
		);

		expect(all.map(c => c.subject)).toEqual([
			'B8PYTCM the late half',
			'B8PYTCM the early half',
		]);
		expect(cut.map(c => c.subject)).toEqual(['B8PYTCM the early half']);
	});

	it('totals only those commits on the card', async () => {
		const timeline = value(await getRefDiffTimeline({repoRoot: board}));
		const all = diffStatsAt(timeline, null);
		const cut = diffStatsAt(timeline, MID_JAN);

		expect(all['B8PYTCM']).toEqual({commits: 2, insertions: 8, deletions: 0});
		expect(cut['B8PYTCM']).toEqual({commits: 1, insertions: 3, deletions: 0});
	});

	it('squashes only those commits', async () => {
		const cut = value(
			await getSquashedDiffForRef({
				repoRoot: board,
				ref: 'B8PYTCM',
				end: MID_JAN,
			}),
		);

		expect(JSON.stringify(cut)).toContain('early.txt');
		expect(JSON.stringify(cut)).not.toContain('late.txt');
	});

	it('has nothing before the ticket’s first commit', async () => {
		const timeline = value(await getRefDiffTimeline({repoRoot: board}));
		const cut = diffStatsAt(timeline, JAN - 500);

		expect(cut['B8PYTCM']).toBeUndefined();
	});
});
