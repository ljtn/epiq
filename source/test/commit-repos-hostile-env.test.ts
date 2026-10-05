import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {isFail, Result} from '../lib/model/result-types.js';

// The user's own git setup, at its least helpful: a hook that runs on every
// ref change, and a URL rewrite onto a transport that runs a command. Set
// before git-utils captures the environment at import, which is why nothing
// above may import anything that reaches it.

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-hostile-env-'));
const hookMarker = path.join(scratch, 'hook-ran');
const extMarker = path.join(scratch, 'ext-ran');
const hooksDir = path.join(scratch, 'hooks');

fs.mkdirSync(hooksDir);
fs.writeFileSync(
	path.join(hooksDir, 'reference-transaction'),
	`#!/bin/sh\necho ran >> "${hookMarker}"\n`,
);
fs.chmodSync(path.join(hooksDir, 'reference-transaction'), 0o755);

process.env['GIT_CONFIG_COUNT'] = '3';
process.env['GIT_CONFIG_KEY_0'] = 'core.hooksPath';
process.env['GIT_CONFIG_VALUE_0'] = hooksDir;
process.env['GIT_CONFIG_KEY_1'] =
	// `% #` ends the command at a shell comment, so the rest of the URL git
	// appends cannot change the marker's name.
	'url.ext::sh -c touch% ' + extMarker + '% #.insteadOf';
process.env['GIT_CONFIG_VALUE_1'] = 'https://evil.example/';
process.env['GIT_CONFIG_KEY_2'] = 'protocol.ext.allow';
process.env['GIT_CONFIG_VALUE_2'] = 'always';
const {fetchCommitRepos, upsertCommitRepo} = await import(
	'../lib/commits/commits.js'
);

afterAll(() => {
	fs.rmSync(scratch, {recursive: true, force: true});
});

const value = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

// The test's own git, without the hostile config.
const git = (cwd: string, args: string[]) =>
	childProcess
		.execFileSync('git', args, {
			cwd,
			env: {
				...process.env,
				GIT_CONFIG_COUNT: '0',
				GIT_AUTHOR_NAME: 'Test',
				GIT_AUTHOR_EMAIL: 'test@example.com',
				GIT_COMMITTER_NAME: 'Test',
				GIT_COMMITTER_EMAIL: 'test@example.com',
			},
		})
		.toString();

const makeBoard = () => {
	const board = fs.mkdtempSync(path.join(scratch, 'board-'));
	git(board, ['init', '-q', '-b', 'main']);
	fs.mkdirSync(path.join(board, '.epiq'));
	fs.writeFileSync(
		path.join(board, '.epiq', 'project.json'),
		JSON.stringify({
			projectId: 'hostile-env',
			stateBranch: 'epiq/state',
			createdAt: '2020-01-01T00:00:00.000Z',
		}),
	);
	fs.writeFileSync(path.join(board, 'a'), 'a');
	git(board, ['add', '-A']);
	git(board, ['commit', '-q', '-m', 'init']);
	git(board, ['branch', 'epiq/state']);
	return board;
};

describe('git on behalf of another repo, under a hostile environment', () => {
	it('runs none of the user’s hooks in a clone', async () => {
		const board = makeBoard();
		const upstream = fs.mkdtempSync(path.join(scratch, 'up-'));
		git(upstream, ['init', '-q', '-b', 'main']);
		fs.writeFileSync(path.join(upstream, 'u'), 'u');
		git(upstream, ['add', '-A']);
		git(upstream, ['commit', '-q', '-m', 'AAAAAAA upstream']);

		value(
			upsertCommitRepo({
				repoRoot: board,
				url: `file://${upstream}`,
				trust: true,
			}),
		);
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(true);
		expect(fs.existsSync(hookMarker)).toBe(false);
	});

	it('cannot be rewritten onto a transport that runs a command', async () => {
		const board = makeBoard();

		value(
			upsertCommitRepo({
				repoRoot: board,
				url: 'https://evil.example/repo.git',
				trust: true,
			}),
		);
		const [outcome] = value(await fetchCommitRepos({repoRoot: board}));

		expect(outcome!.ok).toBe(false);
		expect(fs.existsSync(extMarker)).toBe(false);
	});
});
