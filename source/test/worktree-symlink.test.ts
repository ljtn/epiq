import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {createStateBranch, ensureStateBranchWorktree} from '../git/git.js';
import {isFail} from '../lib/model/result-types.js';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
	const dir = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-worktree-')),
	);
	tempDirs.push(dir);
	return dir;
};

afterAll(() => {
	for (const dir of tempDirs) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

describe('ensureStateBranchWorktree', () => {
	it(
		'treats a symlinked spelling of the worktree path as the same location ' +
			'and preserves uncommitted event appends',
		async () => {
			const base = makeTempDir();
			const repoRoot = path.join(base, 'repo');
			const worktreeRoot = path.join(base, 'worktrees', 'project');
			const stateBranchName = 'epiq/state';

			fs.mkdirSync(repoRoot);
			execSync('git init', {cwd: repoRoot, stdio: 'ignore'});
			execSync('git config user.name Test', {cwd: repoRoot, stdio: 'ignore'});
			execSync('git config user.email test@example.com', {
				cwd: repoRoot,
				stdio: 'ignore',
			});

			const branchResult = await createStateBranch({
				repoRoot,
				stateBranchName,
			});
			expect(isFail(branchResult)).toBe(false);

			const createResult = await ensureStateBranchWorktree({
				repoRoot,
				stateBranchRoot: worktreeRoot,
				stateBranchName,
			});
			expect(isFail(createResult)).toBe(false);

			// Simulate events that are persisted but not yet committed.
			const pendingFile = path.join(worktreeRoot, 'pending.jsonl');
			fs.writeFileSync(pendingFile, 'uncommitted event\n');

			// Reach the same worktree through a symlinked spelling of the path,
			// like /tmp vs /private/tmp on macOS or symlinked home directories.
			const link = path.join(base, 'link');
			fs.symlinkSync(path.join(base, 'worktrees'), link);
			const aliasedWorktreeRoot = path.join(link, 'project');

			const ensureResult = await ensureStateBranchWorktree({
				repoRoot,
				stateBranchRoot: aliasedWorktreeRoot,
				stateBranchName,
			});

			expect(isFail(ensureResult)).toBe(false);
			if (isFail(ensureResult)) return;

			// No relocation must happen, and the pending events must survive.
			expect(ensureResult.value).toBe(false);
			expect(fs.readFileSync(pendingFile, 'utf8')).toBe('uncommitted event\n');
		},
		30_000,
	);
});
