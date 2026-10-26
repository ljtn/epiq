import fs from 'node:fs';
import path from 'node:path';
import {beforeEach, describe, expect, it} from 'vitest';
import {execGit} from '../git/git-utils.js';
import {ensureLocalStateBranch, ensureStateBranchWorktree} from '../git/git.js';
import {ensureStateBranchLayout} from '../git/git-storage.js';
import {toPendingFileName} from '../lib/event/pending-log.js';
import {isFail} from '../lib/model/result-types.js';
import {makeTempDir} from './helpers/git-repo.js';

const BRANCH = 'epiq/state';
const LOG = '.epiq/events/01h0000000000000000000000a.alice.jsonl';

/**
 * Relocating the state worktree must not `--force` remove it: it always holds
 * events written since the last sync.
 */
describe('relocating the state worktree must not discard unsynced events', () => {
	let repoRoot: string;
	let originalRoot: string;
	let otherRoot: string;

	const logPath = () => path.join(originalRoot, LOG);

	beforeEach(async () => {
		repoRoot = makeTempDir();
		originalRoot = path.join(makeTempDir(), 'worktrees', 'project');
		otherRoot = path.join(makeTempDir(), 'worktrees', 'project');

		await execGit({args: ['init', '-q', '-b', 'main', '.'], cwd: repoRoot});
		await execGit({args: ['config', 'user.name', 'Test'], cwd: repoRoot});
		await execGit({args: ['config', 'user.email', 't@test'], cwd: repoRoot});
		fs.writeFileSync(path.join(repoRoot, 'README.md'), 'x\n');
		await execGit({args: ['add', '-A'], cwd: repoRoot});
		await execGit({
			args: ['commit', '-qm', 'init', '--no-verify'],
			cwd: repoRoot,
		});

		const branch = await ensureLocalStateBranch({
			repoRoot,
			stateBranchName: BRANCH,
		});
		if (isFail(branch)) throw new Error(branch.message);

		const created = await ensureStateBranchWorktree({
			repoRoot,
			stateBranchRoot: originalRoot,
			stateBranchName: BRANCH,
		});
		if (isFail(created)) throw new Error(created.message);

		// The steady state of a live board: events appended, not yet synced.
		fs.mkdirSync(path.dirname(logPath()), {recursive: true});
		fs.writeFileSync(logPath(), 'UNSYNCED EVENT\n');
	});

	it('refuses to relocate, and leaves the events where they are', async () => {
		const result = await ensureStateBranchWorktree({
			repoRoot,
			stateBranchRoot: otherRoot,
			stateBranchName: BRANCH,
		});

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('not committed yet');
		expect(result.message).toContain('EPIQ_GLOBAL_DIR');

		expect(fs.existsSync(logPath())).toBe(true);
		expect(fs.readFileSync(logPath(), 'utf8')).toContain('UNSYNCED EVENT');
	});

	// The pending log is ignored by git, so `git status` can't see it.
	it('refuses over a pending log that git status cannot see', async () => {
		const layout = ensureStateBranchLayout(repoRoot, originalRoot);
		if (isFail(layout)) throw new Error(layout.message);

		await execGit({args: ['add', '-A'], cwd: originalRoot});
		await execGit({
			args: ['commit', '-qm', 'sync', '--no-verify'],
			cwd: originalRoot,
		});

		const pendingPath = path.join(
			path.dirname(logPath()),
			toPendingFileName(path.basename(LOG)),
		);
		fs.writeFileSync(pendingPath, 'PENDING EVENT\n');

		const result = await ensureStateBranchWorktree({
			repoRoot,
			stateBranchRoot: otherRoot,
			stateBranchName: BRANCH,
		});

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('not committed yet');

		expect(fs.readFileSync(pendingPath, 'utf8')).toContain('PENDING EVENT');
	});

	// A directory without `.git` is treated as broken and removed, but its logs
	// have no committed copy to recover from.
	it('refuses to delete a broken worktree that still holds event logs', async () => {
		// Its own repo with no worktree registered yet, so this reaches the
		// delete rather than the relocation guard above.
		const freshRepo = makeTempDir();
		await execGit({args: ['init', '-q', '-b', 'main', '.'], cwd: freshRepo});
		await execGit({args: ['config', 'user.name', 'Test'], cwd: freshRepo});
		await execGit({args: ['config', 'user.email', 't@test'], cwd: freshRepo});
		fs.writeFileSync(path.join(freshRepo, 'README.md'), 'x\n');
		await execGit({args: ['add', '-A'], cwd: freshRepo});
		await execGit({
			args: ['commit', '-qm', 'init', '--no-verify'],
			cwd: freshRepo,
		});

		const branch = await ensureLocalStateBranch({
			repoRoot: freshRepo,
			stateBranchName: BRANCH,
		});
		if (isFail(branch)) throw new Error(branch.message);

		// A directory where the worktree should be, holding logs but no `.git`.
		const stranded = path.join(makeTempDir(), 'worktrees', 'project');
		fs.mkdirSync(path.join(stranded, '.epiq', 'events'), {recursive: true});
		fs.writeFileSync(path.join(stranded, LOG), 'STRANDED EVENT\n');

		const result = await ensureStateBranchWorktree({
			repoRoot: freshRepo,
			stateBranchRoot: stranded,
			stateBranchName: BRANCH,
		});

		expect(isFail(result)).toBe(true);
		if (!isFail(result)) return;
		expect(result.message).toContain('event log');

		expect(fs.readFileSync(path.join(stranded, LOG), 'utf8')).toContain(
			'STRANDED EVENT',
		);
	});

	// The relocation itself is legitimate; only doing it over unsynced work is
	// not. A committed worktree still moves.
	it('still relocates a worktree with nothing to lose', async () => {
		await execGit({args: ['add', '-A'], cwd: originalRoot});
		await execGit({
			args: ['commit', '-qm', 'sync', '--no-verify'],
			cwd: originalRoot,
		});

		const result = await ensureStateBranchWorktree({
			repoRoot,
			stateBranchRoot: otherRoot,
			stateBranchName: BRANCH,
		});

		expect(isFail(result)).toBe(false);
		expect(fs.existsSync(path.join(otherRoot, LOG))).toBe(true);
		expect(fs.readFileSync(path.join(otherRoot, LOG), 'utf8')).toContain(
			'UNSYNCED EVENT',
		);
	});
});
