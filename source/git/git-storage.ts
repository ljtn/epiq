import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {memoizeResult} from '../lib/utils/memoize.js';
import {logger} from '../logger.js';
import {commitAndGetSha, execGit} from './git-utils.js';
import {EPIQ_DIR_NAME, GLOBAL_CONFIG_DIR_NAME} from '../paths.js';
import {EVENTS_DIR_NAME} from '../paths.js';

export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export const getRelativeEventFilePath = (fileName: string): string =>
	path.join(EPIQ_DIR_NAME, EVENTS_DIR_NAME, fileName);

const getRepoId = (repoRoot: string): string =>
	createHash('sha1').update(path.resolve(repoRoot)).digest('hex').slice(0, 12);

export const getEpiqGlobal = (): string =>
	path.join(os.homedir(), GLOBAL_CONFIG_DIR_NAME);

export const getWorktreesRoot = (): string =>
	path.join(getEpiqGlobal(), 'worktrees');

export const getStateBranchRoot = (repoRoot: string): string =>
	path.join(getWorktreesRoot(), getRepoId(repoRoot));

const getEpiqRoot = (root: string): string => path.join(root, EPIQ_DIR_NAME);

export const getEventsDir = (root: string): string =>
	path.join(getEpiqRoot(root), EVENTS_DIR_NAME);

export const getEventFilePath = ({
	root,
	fileName,
}: {
	root: string;
	fileName: string;
}): string => path.join(getEventsDir(root), fileName);

export const ensureDir = (dirPath: string): Result<void> => {
	try {
		fs.mkdirSync(dirPath, {recursive: true});
		return succeeded('Ensured directory', undefined);
	} catch (error) {
		return failed(error instanceof Error ? error.message : String(error));
	}
};

export const ensureWorktreesDir = (): Result<boolean> => {
	const homeResult = ensureDir(getEpiqGlobal());
	if (isFail(homeResult)) {
		return failed('Ensure epiq home failed.\n' + homeResult.message);
	}

	const worktreesResult = ensureDir(getWorktreesRoot());
	if (isFail(worktreesResult)) {
		return failed('Ensure worktrees dir failed.\n' + worktreesResult.message);
	}

	return succeeded('Ensured epiq storage', true);
};

export const removePath = (targetPath: string): void => {
	if (!fs.existsSync(targetPath)) return;

	logger.debug('[sync] remove path', targetPath);
	fs.rmSync(targetPath, {recursive: true, force: true});
};
export const listEventFiles = (root: string): Result<string[]> => {
	const eventsDir = getEventsDir(root);

	if (!fs.existsSync(eventsDir)) return succeeded('Events dir missing', []);

	const files = fs
		.readdirSync(eventsDir, {withFileTypes: true})
		.filter(entry => entry.isFile())
		.map(entry => entry.name)
		.filter(name => name.endsWith('.jsonl'))
		.sort();

	return succeeded('Listed event files', files);
};
export const ensureStateBranchLayout = (
	repoRoot: string,
	stateBranchRoot: string,
): Result<void> => {
	for (const dir of [getEventsDir(repoRoot), getEventsDir(stateBranchRoot)]) {
		const result = ensureDir(dir);
		if (isFail(result)) return failed(result.message);
	}

	return succeeded('Ensured state branch', undefined);
};

/**
 * Make sure state branch only contains the .epiq folder
 * */
export const ensureStateBranchIsStorageOnly = async (
	stateBranchRoot: string,
): Promise<Result<boolean>> => {
	const remoteFiles = await execGit({
		args: ['ls-tree', '--name-only', 'HEAD'],
		cwd: stateBranchRoot,
	});

	if (isFail(remoteFiles))
		return failed(
			'ensure state branch is storage only failed\n' + remoteFiles.message,
		);

	const topLevelFiles = remoteFiles.value.stdout
		.trim()
		.split('\n')
		.filter(Boolean);
	const disallowedFiles = topLevelFiles.filter(file => file !== EPIQ_DIR_NAME);

	if (disallowedFiles.length === 0) {
		return succeeded('State branch is storage-only', false);
	}

	const removeResult = await execGit({
		args: ['rm', '-r', '--ignore-unmatch', '--', ...disallowedFiles],
		cwd: stateBranchRoot,
	});

	if (isFail(removeResult)) {
		return failed(`Failed to clean storage branch\n${removeResult.message}`);
	}

	const commitResult = await commitAndGetSha({
		cwd: stateBranchRoot,
		message: '[epiq:repair-storage-branch]',
	});

	if (isFail(commitResult)) return failed(commitResult.message);

	return succeeded('Cleaned storage branch', true);
};

export const getRepoRootDir = memoizeResult(
	async (cwd = process.cwd()): Promise<Result<string>> => {
		const result = await execGit({
			args: ['rev-parse', '--show-toplevel'],
			cwd,
		});

		if (isFail(result)) return failed('Not inside a Git repository');

		return succeeded('Resolved repo root', result.value.stdout.trim());
	},
	cwd => path.resolve(cwd),
);
export const getGitDir = memoizeResult(
	async (repoRoot: string): Promise<Result<string>> => {
		const result = await execGit({
			args: ['rev-parse', '--git-dir'],
			cwd: repoRoot,
		});

		if (isFail(result)) return failed(result.message);

		const gitDir = result.value.stdout.trim();
		const resolved = path.isAbsolute(gitDir)
			? gitDir
			: path.join(repoRoot, gitDir);

		return succeeded('Resolved git dir', resolved);
	},
	(repoRoot: string) => path.resolve(repoRoot),
);
