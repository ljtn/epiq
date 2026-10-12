import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {readOwnRepo} from '../lib/commits/commits.js';

const dirs: string[] = [];

const makeRepo = (name: string): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `epiq-own-${name}-`));
	dirs.push(dir);
	execFileSync('git', ['init', '-q'], {cwd: dir});

	return dir;
};

afterAll(() => {
	for (const dir of dirs) fs.rmSync(dir, {recursive: true, force: true});
});

describe("the board's own repo, as the panel shows it", () => {
	it('is named by its origin, as a linked repo would be', async () => {
		const dir = makeRepo('origin');
		execFileSync(
			'git',
			['remote', 'add', 'origin', 'git@github.com:acme/Service.git'],
			{cwd: dir},
		);

		expect(await readOwnRepo(dir)).toEqual({
			label: 'service',
			url: 'git@github.com:acme/Service.git',
			path: dir,
		});
	});

	it('falls back to the folder when the checkout has no origin', async () => {
		const dir = makeRepo('local');

		expect(await readOwnRepo(dir)).toEqual({
			label: path.basename(dir),
			url: null,
			path: dir,
		});
	});
});
