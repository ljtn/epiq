import fs from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ensureLocalStateBranch} from '../git/git.js';
import {execGit} from '../git/git-utils.js';
import {loadProject, loadWithoutProject} from '../lib/boot/load-project.js';
import {
	listRecentProjects,
	readRecentProjects,
} from '../lib/config/recent-projects.js';
import {isFail} from '../lib/model/result-types.js';
import {DEFAULT_STATE_BRANCH} from '../lib/project-setup/project-setup.js';
import {getState} from '../lib/state/state.js';
import {makeTempDir, useTempHome} from './helpers/git-repo.js';

const git = async (cwd: string, args: string[]) => {
	const result = await execGit({cwd, args});
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

const makeRepo = async (projectId: string): Promise<string> => {
	const repoRoot = path.join(makeTempDir(), projectId);
	fs.mkdirSync(repoRoot, {recursive: true});

	await git(repoRoot, ['init', '-q', '-b', 'main', '.']);
	await git(repoRoot, ['config', 'user.name', 'Test']);
	await git(repoRoot, ['config', 'user.email', 't@test']);
	fs.writeFileSync(path.join(repoRoot, 'README.md'), 'x\n');
	await git(repoRoot, ['add', '-A']);
	await git(repoRoot, ['commit', '-qm', 'init', '--no-verify']);

	fs.mkdirSync(path.join(repoRoot, '.epiq'), {recursive: true});
	fs.writeFileSync(
		path.join(repoRoot, '.epiq', 'project.json'),
		JSON.stringify({
			projectId,
			stateBranch: DEFAULT_STATE_BRANCH,
			createdAt: new Date().toISOString(),
		}),
	);

	const branch = await ensureLocalStateBranch({
		repoRoot,
		stateBranchName: DEFAULT_STATE_BRANCH,
	});
	if (isFail(branch)) throw new Error(branch.message);

	return repoRoot;
};

useTempHome();

let originalGlobalDir: string | undefined;

beforeEach(() => {
	(globalThis as {logger?: unknown}).logger = {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	};

	originalGlobalDir = process.env['EPIQ_GLOBAL_DIR'];
	process.env['EPIQ_GLOBAL_DIR'] = path.join(makeTempDir(), '.epiq-global');
});

afterEach(() => {
	if (originalGlobalDir === undefined) delete process.env['EPIQ_GLOBAL_DIR'];
	else process.env['EPIQ_GLOBAL_DIR'] = originalGlobalDir;
});

describe('loadProject', () => {
	it('records the project it booted as the most recent', async () => {
		const repoRoot = await makeRepo('01LOADPROJECT0000000000001');

		const result = await loadProject(repoRoot);

		expect(isFail(result)).toBe(false);
		const recent = listRecentProjects();
		expect(!isFail(recent) && recent.value.map(entry => entry.root)).toEqual([
			repoRoot,
		]);
		expect(getState().hasProjectDefinition).toBe(true);
	});

	it('keeps earlier projects behind the one just booted', async () => {
		const first = await makeRepo('01LOADPROJECT0000000000002');
		const second = await makeRepo('01LOADPROJECT0000000000003');

		await loadProject(first);
		await loadProject(second);

		const recent = listRecentProjects();
		expect(!isFail(recent) && recent.value.map(entry => entry.root)).toEqual([
			second,
			first,
		]);
	});

	it('does not record a project that failed to load', async () => {
		const notARepo = path.join(makeTempDir(), 'plain');
		fs.mkdirSync(path.join(notARepo, '.epiq'), {recursive: true});
		fs.writeFileSync(
			path.join(notARepo, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: '01LOADPROJECT0000000000004',
				stateBranch: DEFAULT_STATE_BRANCH,
				createdAt: new Date().toISOString(),
			}),
		);

		const result = await loadProject(notARepo);

		expect(isFail(result)).toBe(true);
		const recorded = readRecentProjects();
		expect(!isFail(recorded) && recorded.value).toEqual([]);
	});
});

describe('loadWithoutProject', () => {
	it('boots the placeholder workspace and records nothing', () => {
		const result = loadWithoutProject();

		expect(isFail(result)).toBe(false);
		expect(getState().hasProjectDefinition).toBe(false);
		const recorded = readRecentProjects();
		expect(!isFail(recorded) && recorded.value).toEqual([]);
	});
});
