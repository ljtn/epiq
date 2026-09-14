import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach} from 'vitest';
import {execGit} from '../../git/git-utils.js';
import {isFail} from '../../lib/model/result-types.js';
import {getRelativeEventFilePath} from '../../git/git-storage.js';

const tempDirs: string[] = [];

export const makeTempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-sync-'));
	tempDirs.push(dir);
	return dir;
};

export const writeFile = (filePath: string, content: string): void => {
	fs.mkdirSync(path.dirname(filePath), {recursive: true});
	fs.writeFileSync(filePath, content, 'utf8');
};

export const writeProjectFile = (repoRoot: string): void => {
	writeFile(
		path.join(repoRoot, '.epiq', 'project.json'),
		JSON.stringify(
			{
				projectId: path.basename(repoRoot),
				stateBranch: 'epiq/state',
				createdAt: new Date(),
			},
			null,
			2,
		) + '\n',
	);
};

export const eventLine = (id: string, ref: string | null = null): string =>
	JSON.stringify({
		v: 1,
		id: [id, ref],
		'lock.node': {},
	}) + '\n';

export const getEventsFile = ({
	root,
	fileName,
}: {
	root: string;
	fileName: string;
}): string => path.join(root, getRelativeEventFilePath(fileName));

export const initBareRepo = async (remoteRoot: string): Promise<void> => {
	const initResult = await execGit({
		args: ['init', '--bare'],
		cwd: remoteRoot,
	});
	if (isFail(initResult)) throw new Error(initResult.message);

	const headResult = await execGit({
		args: ['symbolic-ref', 'HEAD', 'refs/heads/main'],
		cwd: remoteRoot,
	});
	if (isFail(headResult)) throw new Error(headResult.message);
};

export const cloneRepo = async ({
	remoteRoot,
	cloneRoot,
}: {
	remoteRoot: string;
	cloneRoot: string;
}): Promise<void> => {
	const cloneResult = await execGit({
		args: ['clone', remoteRoot, cloneRoot],
		cwd: path.dirname(cloneRoot),
	});
	if (isFail(cloneResult)) throw new Error(cloneResult.message);

	for (const [key, value] of [
		['user.name', 'Test User'],
		['user.email', 'test@example.com'],
	] as const) {
		const configResult = await execGit({
			args: ['config', key, value],
			cwd: cloneRoot,
		});
		if (isFail(configResult)) throw new Error(configResult.message);
	}
};

export const commitFile = async ({
	repoRoot,
	fileName,
	content,
	message,
}: {
	repoRoot: string;
	fileName: string;
	content: string;
	message: string;
}): Promise<void> => {
	writeFile(path.join(repoRoot, fileName), content);

	const addResult = await execGit({
		args: ['add', fileName],
		cwd: repoRoot,
	});
	if (isFail(addResult)) throw new Error(addResult.message);

	const commitResult = await execGit({
		args: ['commit', '-m', message],
		cwd: repoRoot,
	});
	if (isFail(commitResult)) throw new Error(commitResult.message);
};

export const setupRepo = async (): Promise<{
	remoteRoot: string;
	repoRoot: string;
}> => {
	const remoteRoot = makeTempDir();
	const repoRoot = makeTempDir();

	await initBareRepo(remoteRoot);
	await cloneRepo({remoteRoot, cloneRoot: repoRoot});
	writeProjectFile(repoRoot);

	// Committed, as init commits it: a clone of this remote is then a checkout
	// of the same project, with the same id.
	await commitFile({
		repoRoot,
		fileName: 'README.md',
		content: 'hello\n',
		message: 'initial',
	});
	const stageProject = await execGit({
		args: ['add', '.epiq/project.json'],
		cwd: repoRoot,
	});
	if (isFail(stageProject)) throw new Error(stageProject.message);
	const commitProject = await execGit({
		args: ['commit', '-q', '-m', '[epiq:init-project]'],
		cwd: repoRoot,
	});
	if (isFail(commitProject)) throw new Error(commitProject.message);

	const pushResult = await execGit({
		args: ['push', '-u', 'origin', 'main'],
		cwd: repoRoot,
	});
	if (isFail(pushResult)) throw new Error(pushResult.message);

	return {remoteRoot, repoRoot};
};

// Points HOME at a throwaway directory so git never reads the developer's
// global config, and clears every temp directory the file made.
export const useTempHome = (): void => {
	let originalHome: string | undefined;

	beforeEach(() => {
		originalHome = process.env['HOME'];
		process.env['HOME'] = makeTempDir();
	});

	afterEach(() => {
		if (originalHome === undefined) {
			delete process.env['HOME'];
		} else {
			process.env['HOME'] = originalHome;
		}

		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, {recursive: true, force: true});
		}
	});
};

// One global dir per machine, as every real machine has: two clones of one
// project sharing a global dir would fight over one state worktree, since
// both name the same project.
const globalDirs = new Map<string, string>();

export const globalDirFor = (repoRoot: string): string => {
	let dir = globalDirs.get(repoRoot);
	if (!dir) {
		dir = path.join(makeTempDir(), '.epiq-global');
		globalDirs.set(repoRoot, dir);
	}
	return dir;
};

/** Runs `fn` as the machine that owns `repoRoot`, then puts the global dir back. */
export const onMachine = async <T>(
	repoRoot: string,
	fn: () => Promise<T>,
): Promise<T> => {
	const previous = process.env['EPIQ_GLOBAL_DIR'];
	process.env['EPIQ_GLOBAL_DIR'] = globalDirFor(repoRoot);

	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env['EPIQ_GLOBAL_DIR'];
		else process.env['EPIQ_GLOBAL_DIR'] = previous;
	}
};
