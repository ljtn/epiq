import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import {loadMergedEvents} from '../lib/board/board-log.js';
import {readCommitRepos} from '../lib/commits/commit-repos.js';
import {getStateBranchRoot} from '../git/git-storage.js';
import {isFail} from '../lib/model/result-types.js';

// Real processes, each its own actor, so their appends land at once.
const ADDER = fileURLToPath(
	new URL('./helpers/repo-adder.ts', import.meta.url),
);
const TSX = fileURLToPath(
	new URL('../../node_modules/.bin/tsx', import.meta.url),
);

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

const add = (board: string, name: string, count: number, startAt: number) =>
	new Promise<{refused: string[]}>((resolve, reject) => {
		const child = spawn(
			TSX,
			[ADDER, board, name, String(count), String(startAt)],
			{
				env: process.env,
			},
		);
		let out = '';
		child.stdout.on('data', chunk => (out += chunk));
		child.on('error', reject);
		child.on('close', () => {
			try {
				resolve(JSON.parse(out));
			} catch (error) {
				reject(new Error(`${String(error)}: ${out}`));
			}
		});
	});

describe('processes connecting repos to one board at once', () => {
	it('keep every connect', async () => {
		const board = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-concurrent-'));
		dirs.push(board);
		fs.mkdirSync(path.join(board, '.epiq'));
		fs.writeFileSync(
			path.join(board, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: 'concurrent-board',
				stateBranch: 'epiq/state',
				createdAt: '2020-01-01T00:00:00.000Z',
			}),
		);

		// After every tsx has started, so the adds land together.
		const startAt = Date.now() + 4_000;
		const outcomes = await Promise.all(
			Array.from({length: 9}, (_, index) =>
				add(board, `adder${index}`, 2, startAt),
			),
		);

		expect(outcomes.flatMap(outcome => outcome.refused)).toEqual([]);

		const root = getStateBranchRoot({repoRoot: board});
		const events = isFail(root) ? root : loadMergedEvents(root.value);
		expect(
			isFail(events)
				? []
				: events.value.filter(event => event.action === 'connect.repo'),
		).toHaveLength(18);

		const repos = readCommitRepos(board);
		expect(
			(isFail(repos) ? [] : repos.value).map(repo => repo.url).sort(),
		).toEqual(
			Array.from({length: 9}, (_, adder) =>
				[0, 1].map(index => `https://example.com/adder${adder}-${index}.git`),
			)
				.flat()
				.sort(),
		);
	}, 30_000);
});
