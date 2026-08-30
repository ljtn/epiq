import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../lib/boot/load-project.js', () => ({
	loadProject: vi.fn(),
}));

vi.mock('../lib/state/cmd.state.js', () => ({
	getCmdArg: vi.fn(() => ''),
	replaceCmdInput: vi.fn(),
}));

let hasProjectDefinition = false;

vi.mock('../lib/state/state.js', () => ({
	getState: () => ({hasProjectDefinition}),
}));

import {loadProject} from '../lib/boot/load-project.js';
import {
	openProjectCommand,
	resolveOpenTarget,
} from '../lib/command-line/commands/open.cmd.js';
import {
	RecentProject,
	recordRecentProject,
} from '../lib/config/recent-projects.js';
import {failed, isFail, succeeded} from '../lib/model/result-types.js';
import {getCmdArg, replaceCmdInput} from '../lib/state/cmd.state.js';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-open-'));
	tempDirs.push(dir);
	return dir;
};

const makeProject = (projectId: string): string => {
	const root = path.join(makeTempDir(), projectId);
	fs.mkdirSync(path.join(root, '.epiq'), {recursive: true});
	fs.writeFileSync(
		path.join(root, '.epiq', 'project.json'),
		JSON.stringify({
			projectId,
			stateBranch: '__epiq_state__',
			createdAt: new Date().toISOString(),
		}),
	);
	return root;
};

const entry = (projectId: string, root: string): RecentProject => ({
	projectId,
	root,
	lastOpenedAt: 1,
});

let originalGlobalDir: string | undefined;
let originalCwd: string;
let originalHome: string | undefined;

beforeEach(() => {
	vi.clearAllMocks();
	hasProjectDefinition = false;
	originalCwd = process.cwd();
	originalHome = process.env['HOME'];
	originalGlobalDir = process.env['EPIQ_GLOBAL_DIR'];
	process.env['EPIQ_GLOBAL_DIR'] = path.join(makeTempDir(), '.epiq-global');
	vi.mocked(loadProject).mockResolvedValue(succeeded('Loaded', undefined));
});

afterEach(() => {
	process.chdir(originalCwd);

	if (originalHome === undefined) delete process.env['HOME'];
	else process.env['HOME'] = originalHome;

	if (originalGlobalDir === undefined) delete process.env['EPIQ_GLOBAL_DIR'];
	else process.env['EPIQ_GLOBAL_DIR'] = originalGlobalDir;

	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

describe('resolveOpenTarget', () => {
	it('needs an argument', () => {
		const result = resolveOpenTarget('   ', []);

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain('Provide');
	});

	it('picks a recent project by its 1-based number', () => {
		const first = makeProject('first');
		const second = makeProject('second');

		const result = resolveOpenTarget('2', [
			entry('first', first),
			entry('second', second),
		]);

		expect(result).toEqual(succeeded('Resolved recent project', second));
	});

	it.each(['0', '3', '99'])('rejects number %s outside the list', arg => {
		const result = resolveOpenTarget(arg, [
			entry('a', makeProject('a')),
			entry('b', makeProject('b')),
		]);

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain(`#${arg}`);
	});

	it('accepts the root of a project by path', () => {
		const root = makeProject('p');

		expect(resolveOpenTarget(root, [])).toEqual(
			succeeded('Resolved project path', root),
		);
	});

	it('resolves a path inside a project to its root', () => {
		const root = makeProject('p');
		const nested = path.join(root, 'src', 'deep');
		fs.mkdirSync(nested, {recursive: true});

		const result = resolveOpenTarget(nested, []);

		expect(!isFail(result) && result.value).toBe(root);
	});

	it('resolves a relative path against cwd', () => {
		const root = makeProject('p');
		process.chdir(path.dirname(root));

		const result = resolveOpenTarget('p', []);

		expect(!isFail(result) && fs.realpathSync(result.value)).toBe(
			fs.realpathSync(root),
		);
	});

	it('expands a leading ~', () => {
		const home = makeTempDir();
		process.env['HOME'] = home;
		const root = path.join(home, 'proj');
		fs.mkdirSync(path.join(root, '.epiq'), {recursive: true});
		fs.writeFileSync(
			path.join(root, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: 'home-proj',
				stateBranch: '__epiq_state__',
				createdAt: new Date().toISOString(),
			}),
		);

		const result = resolveOpenTarget('~/proj', []);

		expect(!isFail(result) && result.value).toBe(root);
	});

	it('rejects a path with no project at or above it', () => {
		const dir = makeTempDir();

		const result = resolveOpenTarget(dir, []);

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain('No epiq project');
	});

	it('does not treat a number-like path as a list index', () => {
		const root = makeProject('p');
		const numbered = path.join(root, '1');
		fs.mkdirSync(numbered);

		const result = resolveOpenTarget(numbered, []);

		expect(!isFail(result) && result.value).toBe(root);
	});
});

describe('openProjectCommand', () => {
	it('moves into the project and loads it', async () => {
		const root = makeProject('target');
		vi.mocked(getCmdArg).mockReturnValue(root);

		const result = await openProjectCommand();

		expect(result).toEqual(succeeded('Opened target', null));
		expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(root));
		expect(loadProject).toHaveBeenCalledWith(root);
		expect(replaceCmdInput).toHaveBeenCalledWith('');
	});

	it('numbers the list the way the init screen shows it', async () => {
		const older = makeProject('older');
		const newer = makeProject('newer');
		recordRecentProject({root: older, now: 1});
		recordRecentProject({root: newer, now: 2});
		vi.mocked(getCmdArg).mockReturnValue('2');

		const result = await openProjectCommand();

		expect(result.message).toBe('Opened older');
		expect(loadProject).toHaveBeenCalledWith(older);
	});

	it('leaves the current project out of the numbering', async () => {
		const here = makeProject('here');
		const there = makeProject('there');
		recordRecentProject({root: here, now: 2});
		recordRecentProject({root: there, now: 1});
		process.chdir(here);
		vi.mocked(getCmdArg).mockReturnValue('1');

		const result = await openProjectCommand();

		expect(result.message).toBe('Opened there');
		expect(loadProject).toHaveBeenCalledWith(there);
	});

	it('refuses to switch away from a project that is already loaded', async () => {
		hasProjectDefinition = true;
		const root = makeProject('elsewhere');
		vi.mocked(getCmdArg).mockReturnValue(root);
		const cwdBefore = process.cwd();

		const result = await openProjectCommand();

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain('Already in a project');
		expect(process.cwd()).toBe(cwdBefore);
		expect(loadProject).not.toHaveBeenCalled();
	});

	it('fails without touching cwd when the target is not a project', async () => {
		vi.mocked(getCmdArg).mockReturnValue(makeTempDir());
		const cwdBefore = process.cwd();

		const result = await openProjectCommand();

		expect(isFail(result)).toBe(true);
		expect(process.cwd()).toBe(cwdBefore);
		expect(loadProject).not.toHaveBeenCalled();
	});

	it('returns to the previous directory when the project fails to load', async () => {
		const root = makeProject('broken');
		vi.mocked(getCmdArg).mockReturnValue(root);
		vi.mocked(loadProject).mockResolvedValue(failed('[boot:3] no worktree'));
		const cwdBefore = process.cwd();

		const result = await openProjectCommand();

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain('no worktree');
		expect(process.cwd()).toBe(cwdBefore);
	});

	it('still opens by path when the registry is corrupt', async () => {
		const globalDir = process.env['EPIQ_GLOBAL_DIR']!;
		fs.mkdirSync(globalDir, {recursive: true});
		fs.writeFileSync(path.join(globalDir, 'recent-projects.json'), '{oops');
		const root = makeProject('p');
		vi.mocked(getCmdArg).mockReturnValue(root);

		const result = await openProjectCommand();

		expect(isFail(result)).toBe(false);
		expect(loadProject).toHaveBeenCalledWith(root);
	});
});
