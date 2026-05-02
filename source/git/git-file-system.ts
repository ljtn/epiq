import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getEpiqDirName} from '../init.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {logger} from '../logger.js';
import {execGit, commitAndGetSha} from './git-utils.js';
import path from 'node:path';
import {memoizeResult} from '../lib/utils/memoize.js';

export const EPIQ_DIR = getEpiqDirName();
const EVENTS_SUBDIR = 'events';

export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export const getRelativeEventFilePath = (fileName: string): string =>
	path.join(EPIQ_DIR, EVENTS_SUBDIR, fileName);

const getRepoId = (repoRoot: string): string =>
	createHash('sha1').update(path.resolve(repoRoot)).digest('hex').slice(0, 12);

export const getEpiqHome = (): string => path.join(os.homedir(), '.epiq');

export const getWorktreesRoot = (): string =>
	path.join(getEpiqHome(), 'worktrees');

export const getRemoteWorktreeRoot = (repoRoot: string): string =>
	path.join(getWorktreesRoot(), getRepoId(repoRoot));

const getEpiqRoot = (root: string): string => path.join(root, EPIQ_DIR);
export const getEventsDir = (root: string): string =>
	path.join(getEpiqRoot(root), EVENTS_SUBDIR);
export const getEventFilePath = ({
	root,
	fileName,
}: {
	root: string;
	fileName: string;
}): string => path.join(getEventsDir(root), fileName);
export const ensureDir = (dirPath: string): Result<void> => {
	fs.mkdirSync(dirPath, {recursive: true});
	return succeeded('Ensured directory', undefined);
};
export const ensureEpiqStorage = (): Result<void> => {
	const homeResult = ensureDir(getEpiqHome());
	if (isFail(homeResult))
		return failed('Ensure epiq storage failed. ' + homeResult.message);

	const worktreesResult = ensureDir(getWorktreesRoot());
	if (isFail(worktreesResult))
		return failed('Ensure epiq storage failed. ' + worktreesResult.message);

	return succeeded('Ensured epiq storage', undefined);
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
export const ensureRemoteLayout = (
	repoRoot: string,
	worktreeRoot: string,
): Result<void> => {
	for (const dir of [getEventsDir(repoRoot), getEventsDir(worktreeRoot)]) {
		const result = ensureDir(dir);
		if (isFail(result)) return failed(result.message);
	}

	return succeeded('Ensured remote layout', undefined);
};

/**
 * Make sure remote/storage branch only contains the .epiq folder
 * */
export const ensureRemoteBranchIsStorageOnly = async (
	worktreeRoot: string,
): Promise<Result<boolean>> => {
	const remoteFiles = await execGit({
		args: ['ls-tree', '--name-only', 'HEAD'],
		cwd: worktreeRoot,
	});

	if (isFail(remoteFiles))
		return failed(
			'ensure remote branch is storage only failed\n' + remoteFiles.message,
		);

	const topLevelFiles = remoteFiles.data.stdout
		.trim()
		.split('\n')
		.filter(Boolean);
	const disallowedFiles = topLevelFiles.filter(file => file !== EPIQ_DIR);

	if (disallowedFiles.length === 0) {
		return succeeded('Remote branch is storage-only', false);
	}

	const removeResult = await execGit({
		args: ['rm', '-r', '--ignore-unmatch', '--', ...disallowedFiles],
		cwd: worktreeRoot,
	});

	if (isFail(removeResult)) {
		return failed(`Failed to clean storage branch\n${removeResult.message}`);
	}

	const commitResult = await commitAndGetSha({
		cwd: worktreeRoot,
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

		return succeeded('Resolved repo root', result.data.stdout.trim());
	},
	cwd => path.resolve(cwd),
);
