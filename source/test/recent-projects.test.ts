import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	getRecentProjectsPath,
	listRecentProjects,
	MAX_RECENT_PROJECTS,
	readRecentProjects,
	RECENT_PROJECTS_FILE_NAME,
	recentProjectName,
	recordRecentProject,
} from '../lib/config/recent-projects.js';
import {isFail, Result} from '../lib/model/result-types.js';

const tempDirs: string[] = [];

const makeTempDir = (prefix = 'epiq-recent-'): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
};

const makeProject = (projectId: string, name = projectId): string => {
	const root = path.join(makeTempDir(), name);
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

const unwrap = <T>(result: Result<T>): T => {
	if (isFail(result)) throw new Error(result.message);
	return result.value;
};

let originalGlobalDir: string | undefined;

beforeEach(() => {
	originalGlobalDir = process.env['EPIQ_GLOBAL_DIR'];
	process.env['EPIQ_GLOBAL_DIR'] = path.join(makeTempDir(), '.epiq-global');
});

afterEach(() => {
	if (originalGlobalDir === undefined) {
		delete process.env['EPIQ_GLOBAL_DIR'];
	} else {
		process.env['EPIQ_GLOBAL_DIR'] = originalGlobalDir;
	}

	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

describe('getRecentProjectsPath', () => {
	it('lives next to config.json in the global dir', () => {
		expect(getRecentProjectsPath()).toBe(
			path.join(process.env['EPIQ_GLOBAL_DIR']!, RECENT_PROJECTS_FILE_NAME),
		);
	});
});

describe('recentProjectName', () => {
	it('is the directory name', () => {
		expect(recentProjectName('/home/me/dev/epiq')).toBe('epiq');
	});

	it('falls back to the root itself when there is no basename', () => {
		expect(recentProjectName('/')).toBe('/');
	});
});

describe('readRecentProjects', () => {
	it('is empty before anything was recorded, without creating the file', () => {
		expect(unwrap(readRecentProjects())).toEqual([]);
		expect(fs.existsSync(getRecentProjectsPath())).toBe(false);
	});

	it('fails on malformed JSON', () => {
		fs.mkdirSync(path.dirname(getRecentProjectsPath()), {recursive: true});
		fs.writeFileSync(getRecentProjectsPath(), '{not json');

		const result = readRecentProjects();

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain(RECENT_PROJECTS_FILE_NAME);
	});

	it('fails on a well-formed file of the wrong shape', () => {
		fs.mkdirSync(path.dirname(getRecentProjectsPath()), {recursive: true});
		fs.writeFileSync(
			getRecentProjectsPath(),
			JSON.stringify({projects: [{root: '/x'}]}),
		);

		const result = readRecentProjects();

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain('shape');
	});
});

describe('recordRecentProject', () => {
	it('creates the global dir and file on first record', () => {
		const root = makeProject('p1');

		const recorded = unwrap(recordRecentProject({root, now: 100}));

		expect(recorded).toEqual([{projectId: 'p1', root, lastOpenedAt: 100}]);
		expect(
			JSON.parse(fs.readFileSync(getRecentProjectsPath(), 'utf8')),
		).toEqual({projects: recorded});
	});

	it('refuses a directory that is not a project', () => {
		const result = recordRecentProject({root: makeTempDir()});

		expect(isFail(result)).toBe(true);
		expect(fs.existsSync(getRecentProjectsPath())).toBe(false);
	});

	it('stores the resolved absolute root', () => {
		const root = makeProject('p1');
		const relative = path.relative(process.cwd(), root);

		const recorded = unwrap(recordRecentProject({root: relative, now: 1}));

		expect(recorded[0]?.root).toBe(root);
	});

	it('moves a re-opened project to the top instead of duplicating it', () => {
		const first = makeProject('p1');
		const second = makeProject('p2');

		recordRecentProject({root: first, now: 1});
		recordRecentProject({root: second, now: 2});
		const recorded = unwrap(recordRecentProject({root: first, now: 3}));

		expect(recorded.map(entry => entry.root)).toEqual([first, second]);
		expect(recorded[0]?.lastOpenedAt).toBe(3);
	});

	it('keys on the project id, so a moved checkout updates its entry', () => {
		const before = makeProject('p1', 'before');
		recordRecentProject({root: before, now: 1});

		const after = path.join(path.dirname(before), 'after');
		fs.renameSync(before, after);

		const recorded = unwrap(recordRecentProject({root: after, now: 2}));

		expect(recorded).toEqual([{projectId: 'p1', root: after, lastOpenedAt: 2}]);
	});

	it('replaces the entry of a directory re-initialised as another project', () => {
		const root = makeProject('p1');
		recordRecentProject({root, now: 1});

		fs.writeFileSync(
			path.join(root, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: 'p2',
				stateBranch: '__epiq_state__',
				createdAt: new Date().toISOString(),
			}),
		);

		const recorded = unwrap(recordRecentProject({root, now: 2}));

		expect(recorded).toEqual([{projectId: 'p2', root, lastOpenedAt: 2}]);
	});

	it('drops entries whose project has since disappeared', () => {
		const gone = makeProject('gone');
		const kept = makeProject('kept');
		recordRecentProject({root: gone, now: 1});
		fs.rmSync(gone, {recursive: true, force: true});

		const recorded = unwrap(recordRecentProject({root: kept, now: 2}));

		expect(recorded.map(entry => entry.projectId)).toEqual(['kept']);
	});

	it('keeps the newest entries when the registry is full', () => {
		for (let index = 0; index < MAX_RECENT_PROJECTS; index += 1) {
			recordRecentProject({root: makeProject(`p${index}`), now: index});
		}

		const recorded = unwrap(
			recordRecentProject({root: makeProject('newest'), now: 1000}),
		);

		expect(recorded).toHaveLength(MAX_RECENT_PROJECTS);
		expect(recorded[0]?.projectId).toBe('newest');
		expect(recorded.some(entry => entry.projectId === 'p0')).toBe(false);
	});

	it('starts over from a corrupt registry rather than failing the boot', () => {
		fs.mkdirSync(path.dirname(getRecentProjectsPath()), {recursive: true});
		fs.writeFileSync(getRecentProjectsPath(), '{not json');
		const root = makeProject('p1');

		const recorded = unwrap(recordRecentProject({root, now: 1}));

		expect(recorded).toEqual([{projectId: 'p1', root, lastOpenedAt: 1}]);
		expect(unwrap(readRecentProjects())).toEqual(recorded);
	});

	it('fails when the registry cannot be written', () => {
		const blocker = path.join(makeTempDir(), 'file');
		fs.writeFileSync(blocker, '');
		process.env['EPIQ_GLOBAL_DIR'] = path.join(blocker, 'nested');

		const result = recordRecentProject({root: makeProject('p1')});

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain('Unable to write');
	});
});

describe('listRecentProjects', () => {
	it('is empty before anything was recorded', () => {
		expect(unwrap(listRecentProjects())).toEqual([]);
	});

	it('orders by most recently opened, whatever order the file holds', () => {
		const older = makeProject('older');
		const newer = makeProject('newer');
		fs.mkdirSync(path.dirname(getRecentProjectsPath()), {recursive: true});
		fs.writeFileSync(
			getRecentProjectsPath(),
			JSON.stringify({
				projects: [
					{projectId: 'older', root: older, lastOpenedAt: 1},
					{projectId: 'newer', root: newer, lastOpenedAt: 2},
				],
			}),
		);

		expect(unwrap(listRecentProjects()).map(entry => entry.root)).toEqual([
			newer,
			older,
		]);
	});

	it('hides a project whose directory no longer exists', () => {
		const gone = makeProject('gone');
		const kept = makeProject('kept');
		recordRecentProject({root: gone, now: 2});
		recordRecentProject({root: kept, now: 1});
		fs.rmSync(gone, {recursive: true, force: true});

		expect(unwrap(listRecentProjects()).map(entry => entry.projectId)).toEqual([
			'kept',
		]);
	});

	it('hides a project whose directory lost its project file', () => {
		const root = makeProject('p1');
		recordRecentProject({root, now: 1});
		fs.rmSync(path.join(root, '.epiq'), {recursive: true, force: true});

		expect(unwrap(listRecentProjects())).toEqual([]);
	});

	it('hides an entry whose directory now hosts a different project', () => {
		const root = makeProject('p1');
		recordRecentProject({root, now: 1});
		fs.writeFileSync(
			path.join(root, '.epiq', 'project.json'),
			JSON.stringify({
				projectId: 'p2',
				stateBranch: '__epiq_state__',
				createdAt: new Date().toISOString(),
			}),
		);

		expect(unwrap(listRecentProjects())).toEqual([]);
	});

	it('leaves the file alone when hiding stale entries', () => {
		const gone = makeProject('gone');
		recordRecentProject({root: gone, now: 1});
		fs.rmSync(gone, {recursive: true, force: true});

		listRecentProjects();

		expect(unwrap(readRecentProjects())).toHaveLength(1);
	});

	it('excludes the project the caller is already in', () => {
		const here = makeProject('here');
		const there = makeProject('there');
		recordRecentProject({root: here, now: 2});
		recordRecentProject({root: there, now: 1});

		const listed = unwrap(listRecentProjects({exclude: here}));

		expect(listed.map(entry => entry.projectId)).toEqual(['there']);
	});

	it('excludes by resolved path, so a relative cwd still matches', () => {
		const here = makeProject('here');
		recordRecentProject({root: here, now: 1});

		const listed = unwrap(
			listRecentProjects({exclude: path.relative(process.cwd(), here)}),
		);

		expect(listed).toEqual([]);
	});

	it('propagates a corrupt registry as a failure', () => {
		fs.mkdirSync(path.dirname(getRecentProjectsPath()), {recursive: true});
		fs.writeFileSync(getRecentProjectsPath(), '[]');

		expect(isFail(listRecentProjects())).toBe(true);
	});
});
