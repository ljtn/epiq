import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {getCommitDiff, withCommitBodies} from '../lib/commits/commits.js';
import {succeeded} from '../lib/model/result-types.js';
import {isFail, Result} from '../lib/model/result-types.js';

// A commit's diff carries its body, so the GUI can say why a commit is linked
// to a ticket whose ref is only in an Epiq-Ref line.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-commit-body-'));

afterAll(() => fs.rmSync(dir, {recursive: true, force: true}));

const git = (...args: string[]) =>
	childProcess
		.execFileSync('git', args, {
			cwd: dir,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
			},
		})
		.toString()
		.trim();

const commit = (...messages: string[]) => {
	fs.appendFileSync(path.join(dir, 'file.txt'), `${messages[0]}\n`);
	git('add', 'file.txt');
	git('commit', '-q', ...messages.flatMap(message => ['-m', message]));
	return git('rev-parse', 'HEAD');
};

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

git('init', '-q', '-b', 'main');
fs.mkdirSync(path.join(dir, '.epiq'));
fs.writeFileSync(
	path.join(dir, '.epiq', 'project.json'),
	JSON.stringify({
		projectId: path.basename(dir),
		stateBranch: 'epiq/state',
		createdAt: '2020-01-01T00:00:00.000Z',
	}),
);

describe('a commit diff', () => {
	it('carries the body, line for line', async () => {
		const sha = commit(
			'fix the parser',
			'It dropped the last token.\nTwo lines.',
			'Epiq-Ref: ABC1234',
		);

		const diff = value(await getCommitDiff({repoRoot: dir, sha}));

		expect(diff.body).toBe(
			'It dropped the last token.\nTwo lines.\n\nEpiq-Ref: ABC1234',
		);
	});

	it('drops controls and bidi overrides from it, keeping newlines and tabs', async () => {
		const sha = commit('hostile', 'a‮b\u0007c\n\td');

		const diff = value(await getCommitDiff({repoRoot: dir, sha}));

		expect(diff.body).toBe('abc\n\td');
	});

	it('has none for a commit with only a subject', async () => {
		const sha = commit('just a subject');

		const diff = value(await getCommitDiff({repoRoot: dir, sha}));

		expect(diff.body).toBeUndefined();
	});
});

describe('a list of commits', () => {
	it('gets each one its body, in one read', async () => {
		const withBody = commit('a', 'Why a.\n\nEpiq-Ref: ABC1234');
		const without = commit('b');

		const listed = value(
			await withCommitBodies(
				dir,
				succeeded('Listed', [entryOf(withBody), entryOf(without)]),
			),
		);

		expect(listed[0]!.body).toBe('Why a.\n\nEpiq-Ref: ABC1234');
		expect(listed[1]!.body).toBeUndefined();
	});

	it('cannot be told another commit’s body by a hostile one', async () => {
		const victim = commit('victim');
		const hostile = commit('hostile', `\x1e${victim}\x1fforged`);

		const listed = value(
			await withCommitBodies(
				dir,
				succeeded('Listed', [entryOf(hostile), entryOf(victim)]),
			),
		);

		expect(listed[1]!.body).toBeUndefined();
	});

	// git refuses a whole list over one name that is not a commit there.
	it('keeps the others’ bodies when one sha is gone and one is not a commit', async () => {
		const first = commit('first', 'Why first.');
		const second = commit('second', 'Why second.');
		const tree = git('rev-parse', 'HEAD^{tree}');

		const listed = value(
			await withCommitBodies(
				dir,
				succeeded('Listed', [
					entryOf(first),
					entryOf('1234567890123456789012345678901234567890'),
					entryOf(tree),
					entryOf(second),
				]),
			),
		);

		expect(listed.map(entry => entry.body)).toEqual([
			'Why first.',
			undefined,
			undefined,
			'Why second.',
		]);
	});
});

function entryOf(sha: string) {
	return {
		sha,
		time: 0,
		author: 'Test',
		authorEmail: 'test@example.com',
		subject: '',
		linesChanged: 1,
		insertions: 1,
		deletions: 0,
	};
}
