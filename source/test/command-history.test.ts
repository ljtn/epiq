import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	COMMAND_HISTORY_FILE_NAME,
	getCommandHistoryPath,
	MAX_COMMAND_HISTORY_PROJECTS,
	readCommandHistory,
	writeCommandHistory,
} from '../lib/config/command-history.js';
import {isFail, isSuccess, Result} from '../lib/model/result-types.js';
import {COMMAND_HISTORY_HORIZON} from '../lib/state/cmd.state.js';

// A temp root of this test's own: the real one holds whatever the developer's
// own epiq has recorded, and every worker would otherwise share one file.
let root: string;

const unwrap = <T>(result: Result<T>): T => {
	if (!isSuccess(result)) throw new Error(result.message);
	return result.value;
};

const makeProject = (projectId: string): string => {
	const projectRoot = path.join(root, 'projects', projectId);
	fs.mkdirSync(path.join(projectRoot, '.epiq'), {recursive: true});
	fs.writeFileSync(
		path.join(projectRoot, '.epiq', 'project.json'),
		JSON.stringify({
			projectId,
			stateBranch: '__epiq_state__',
			createdAt: new Date().toISOString(),
		}),
	);
	return projectRoot;
};

const historyFile = () => unwrap(getCommandHistoryPath());

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-cmd-history-'));
	vi.spyOn(os, 'tmpdir').mockReturnValue(root);
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(root, {recursive: true, force: true});
});

describe('getCommandHistoryPath', () => {
	it('lives in epiq’s own private directory under the temp dir', () => {
		expect(historyFile()).toBe(
			path.join(root, 'epiq', COMMAND_HISTORY_FILE_NAME),
		);
	});

	// The whole reason it goes through privateTempDir: on Linux the temp dir is
	// shared, and the history carries a private repository's ticket refs.
	it('is created private', () => {
		const dir = path.dirname(historyFile());

		expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
	});
});

describe('readCommandHistory', () => {
	it('is empty for a project that has never recorded anything', () => {
		const project = makeProject('PROJECT_A');

		expect(unwrap(readCommandHistory({root: project}))).toEqual([]);
	});

	it('fails on a directory that is not a project', () => {
		expect(isFail(readCommandHistory({root: path.join(root, 'nowhere')}))).toBe(
			true,
		);
	});

	it('reports a file it cannot parse', () => {
		const project = makeProject('PROJECT_A');
		unwrap(writeCommandHistory({commands: [':sync'], root: project}));
		fs.writeFileSync(historyFile(), 'not json', 'utf8');

		const result = readCommandHistory({root: project});

		expect(isFail(result)).toBe(true);
		expect(result.message).toContain(COMMAND_HISTORY_FILE_NAME);
	});
});

describe('writeCommandHistory', () => {
	it('round-trips the history, most recent command first', () => {
		const project = makeProject('PROJECT_A');

		unwrap(
			writeCommandHistory({
				commands: [':new issue Later', ':sync'],
				root: project,
			}),
		);

		expect(unwrap(readCommandHistory({root: project}))).toEqual([
			':new issue Later',
			':sync',
		]);
	});

	it('keeps each project’s history to itself', () => {
		const a = makeProject('PROJECT_A');
		const b = makeProject('PROJECT_B');

		unwrap(writeCommandHistory({commands: [':move ABC123 done'], root: a}));
		unwrap(writeCommandHistory({commands: [':tag XYZ789 bug'], root: b}));

		expect(unwrap(readCommandHistory({root: a}))).toEqual([
			':move ABC123 done',
		]);
		expect(unwrap(readCommandHistory({root: b}))).toEqual([':tag XYZ789 bug']);
	});

	it('replaces the project’s previous history rather than appending to it', () => {
		const project = makeProject('PROJECT_A');

		unwrap(writeCommandHistory({commands: [':sync'], root: project}));
		unwrap(
			writeCommandHistory({commands: [':peek ABC123', ':sync'], root: project}),
		);

		expect(unwrap(readCommandHistory({root: project}))).toEqual([
			':peek ABC123',
			':sync',
		]);
	});

	it('stores no more than the horizon ↑ reaches back through', () => {
		const project = makeProject('PROJECT_A');
		const commands = Array.from(
			{length: COMMAND_HISTORY_HORIZON + 10},
			(_, index) => `:peek REF${index}`,
		);

		unwrap(writeCommandHistory({commands, root: project}));

		const stored = unwrap(readCommandHistory({root: project}));

		expect(stored).toHaveLength(COMMAND_HISTORY_HORIZON);
		expect(stored[0]).toBe(':peek REF0');
		expect(stored.at(-1)).toBe(`:peek REF${COMMAND_HISTORY_HORIZON - 1}`);
	});

	// Nothing prunes this file but the OS clearing the temp dir, so a machine
	// that opens many projects must not grow it without bound.
	it('drops the least recently used project past the cap', () => {
		const projects = Array.from(
			{length: MAX_COMMAND_HISTORY_PROJECTS + 1},
			(_, index) => makeProject(`PROJECT_${index}`),
		);

		projects.forEach((project, index) => {
			unwrap(
				writeCommandHistory({
					commands: [`:peek REF${index}`],
					root: project,
					now: 1_000 + index,
				}),
			);
		});

		expect(unwrap(readCommandHistory({root: projects[0]!}))).toEqual([]);
		expect(unwrap(readCommandHistory({root: projects[1]!}))).toEqual([
			':peek REF1',
		]);
		expect(unwrap(readCommandHistory({root: projects.at(-1)!}))).toEqual([
			`:peek REF${MAX_COMMAND_HISTORY_PROJECTS}`,
		]);
	});

	// Losing history is not a reason to fail the command that was just run.
	it('replaces a file it cannot parse', () => {
		const project = makeProject('PROJECT_A');
		unwrap(writeCommandHistory({commands: [':sync'], root: project}));
		fs.writeFileSync(historyFile(), '{"projects": "nonsense"}', 'utf8');

		unwrap(writeCommandHistory({commands: [':peek ABC123'], root: project}));

		expect(unwrap(readCommandHistory({root: project}))).toEqual([
			':peek ABC123',
		]);
	});

	it('stores nothing when there is no project', () => {
		unwrap(writeCommandHistory({commands: [':init'], root: null}));

		expect(fs.existsSync(historyFile())).toBe(false);
	});

	it('falls back to the project the process stands in', () => {
		const project = makeProject('PROJECT_A');
		const cwd = vi.spyOn(process, 'cwd').mockReturnValue(project);

		unwrap(writeCommandHistory({commands: [':sync']}));
		cwd.mockRestore();

		expect(unwrap(readCommandHistory({root: project}))).toEqual([':sync']);
	});
});
