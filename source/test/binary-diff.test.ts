import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {getCommitDiff} from '../lib/commits/commit-diff.js';
import {isFail} from '../lib/model/result-types.js';
import {openableByDefault} from '../lib/utils/diff-size.js';

// A commit that added a jpeg drew the jpeg: 156 rows of decoded bytes, syntax
// highlighted, down the diff panel. Git had already said the file was binary —
// `--numstat` gives `-\t-` for one — and the answer was being read and thrown
// away.
//
// Against real git rather than a fixture: what is under test is agreement with
// git about which files it will diff, and a hand-written numstat line would
// only test the regex.

let repo = '';

const git = (...args: string[]) =>
	execFileSync('git', args, {cwd: repo, stdio: 'pipe'}).toString();

const write = (name: string, contents: Buffer | string) =>
	fs.writeFileSync(path.join(repo, name), contents);

beforeEach(() => {
	repo = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-binary-'));

	git('init', '-q', '-b', 'main');
	git('config', 'user.name', 'Test');
	git('config', 'user.email', 'test@example.com');
	git('config', 'commit.gpgsign', 'false');

	// `getCommitDiff` resolves its repo root by finding one, so the temp repo
	// has to look like a project.
	fs.mkdirSync(path.join(repo, '.epiq'));
	write(
		'.epiq/project.json',
		JSON.stringify({
			projectId: '01M2XZW1424SQK471GQRM4X72P',
			stateBranch: '__epiq_state__',
			createdAt: new Date(0).toISOString(),
		}),
	);

	write('readme.md', '# first\n');
	git('add', '-A');
	git('commit', '-q', '-m', 'first');
});

afterEach(() => {
	fs.rmSync(repo, {recursive: true, force: true});
});

const commitDiff = async () => {
	const sha = git('rev-parse', 'HEAD').trim();
	const result = await getCommitDiff({repoRoot: repo, sha});
	if (isFail(result)) throw new Error(result.message);

	return result.value.files;
};

describe('a binary file in a commit diff', () => {
	// A NUL in the first 8k is what git reads as binary, and what a jpeg has in
	// its first few bytes.
	const BINARY = Buffer.from([0x89, 0x50, 0x00, 0x01, 0xff, 0xd8, 0x00, 0x42]);

	it('is reported as binary, with neither side read', async () => {
		write('picture.jpeg', BINARY);
		git('add', '-A');
		git('commit', '-q', '-m', 'add a picture');

		const [file] = await commitDiff();

		expect(file?.path).toBe('picture.jpeg');
		expect(file?.isBinary).toBe(true);
		// The bug: these carried the bytes, and the panel drew them.
		expect(file?.before).toBe('');
		expect(file?.after).toBe('');
	});

	it('leaves an ordinary file alone', async () => {
		write('readme.md', '# first\n# second\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'edit the readme');

		const [file] = await commitDiff();

		expect(file?.isBinary).toBe(false);
		expect(file?.after).toBe('# first\n# second\n');
		expect(file?.insertions).toBe(1);
	});

	// One commit, both kinds: the binary one must not take the text one's
	// content with it, which a filter applied to the wrong list would do.
	it('reads the text file in a commit that also changed a binary one', async () => {
		write('picture.jpeg', BINARY);
		write('readme.md', '# first\n# second\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'both');

		const files = await commitDiff();
		const picture = files.find(file => file.path === 'picture.jpeg');
		const readme = files.find(file => file.path === 'readme.md');

		expect(picture?.isBinary).toBe(true);
		expect(picture?.after).toBe('');
		expect(readme?.isBinary).toBe(false);
		expect(readme?.after).toBe('# first\n# second\n');
	});

	// A file a `.gitattributes` marks `-diff` is one git will not diff either,
	// and it says so the same way. The reader gets the same answer for the same
	// reason, rather than a guess at the bytes disagreeing with git.
	it('follows git when .gitattributes says not to diff a text file', async () => {
		write('.gitattributes', 'secrets.txt -diff\n');
		write('secrets.txt', 'plain text\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'mark it');

		write('secrets.txt', 'plain text, changed\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'change it');

		const [file] = await commitDiff();

		expect(file?.path).toBe('secrets.txt');
		expect(file?.isBinary).toBe(true);
		expect(file?.after).toBe('');
	});

	// Nothing to open, and no size to judge it by — so left to the per-file
	// limits it would be the cheapest file in the commit and go first.
	it('is never opened unasked', () => {
		const files = [
			{path: 'picture.jpeg', before: '', after: '', isBinary: true},
			{path: 'readme.md', before: '', after: '# a\n', isBinary: false},
		];

		expect(openableByDefault(files)).toEqual([false, true]);
	});
});
