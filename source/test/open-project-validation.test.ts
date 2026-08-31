import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../lib/state/state.js', () => ({
	getState: () => ({
		contextNode: {id: 'ws', title: 'Workspace', context: 'WORKSPACE'},
		selectedNode: undefined,
		contributors: {},
		tags: {},
		epics: {},
		breadCrumb: [],
		readOnly: false,
	}),
}));

vi.mock('../lib/state/settings.state.js', () => ({
	getSettingsState: () => ({
		preferredEditor: 'vim',
		autoSync: true,
		userName: 'jola',
	}),
}));

let initialized = false;

vi.mock('../lib/config/setup-utils.js', async importOriginal => {
	const actual = await importOriginal<
		typeof import('../lib/config/setup-utils.js')
	>();

	return {
		...actual,
		isRepositoryInitialized: () => initialized,
	};
});

import {CmdKeywords} from '../lib/command-line/cmd-keywords.js';
import {cmdValidity} from '../lib/command-line/cmd-validity.js';
import {
	getCmdModifiers,
	getOpenProjectModifiers,
} from '../lib/command-line/command-modifiers.js';
import {cmdValidation} from '../lib/command-line/command-validation.js';
import {getCommandIntent} from '../lib/command-line/command-intent.js';
import {CmdIntent} from '../lib/command-line/command-intent.js';
import {recordRecentProject} from '../lib/config/recent-projects.js';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-open-val-'));
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

let originalGlobalDir: string | undefined;

beforeEach(() => {
	initialized = false;
	originalGlobalDir = process.env['EPIQ_GLOBAL_DIR'];
	process.env['EPIQ_GLOBAL_DIR'] = path.join(makeTempDir(), '.epiq-global');
});

afterEach(() => {
	if (originalGlobalDir === undefined) delete process.env['EPIQ_GLOBAL_DIR'];
	else process.env['EPIQ_GLOBAL_DIR'] = originalGlobalDir;

	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, {recursive: true, force: true});
	}
});

describe(':open availability', () => {
	it('is offered outside a project, next to init', () => {
		expect(getCmdModifiers(CmdKeywords.NONE)).toEqual([
			CmdKeywords.HELP,
			CmdKeywords.INIT,
			CmdKeywords.OPEN,
		]);
	});

	it('is not offered inside a project', () => {
		initialized = true;

		expect(getCmdModifiers(CmdKeywords.NONE)).not.toContain(CmdKeywords.OPEN);
	});

	it('maps the keyword to its intent', () => {
		expect(getCommandIntent(CmdKeywords.OPEN)).toBe(CmdIntent.OpenProject);
	});
});

describe(':open completions', () => {
	it('offers nothing when no project was recorded', () => {
		expect(getOpenProjectModifiers()).toEqual([]);
		expect(getCmdModifiers(CmdKeywords.OPEN)).toEqual([]);
	});

	it('offers list numbers first, then the roots, most recent first', () => {
		const older = makeProject('older');
		const newer = makeProject('newer');
		recordRecentProject({root: older, now: 1});
		recordRecentProject({root: newer, now: 2});

		expect(getCmdModifiers(CmdKeywords.OPEN)).toEqual(['1', '2', newer, older]);
	});

	it('is only read when completing the open command itself', () => {
		const root = makeProject('p');
		recordRecentProject({root, now: 1});
		const globalDir = process.env['EPIQ_GLOBAL_DIR']!;
		fs.chmodSync(globalDir, 0o000);

		try {
			// Other commands must not stall or fail on an unreadable registry.
			expect(() => getCmdModifiers(CmdKeywords.HELP)).not.toThrow();
			expect(getCmdModifiers(CmdKeywords.INIT)).toEqual([]);
		} finally {
			fs.chmodSync(globalDir, 0o755);
		}

		expect(getCmdModifiers(CmdKeywords.OPEN)).toEqual(['1', root]);
	});

	it('offers nothing from a corrupt registry', () => {
		const globalDir = process.env['EPIQ_GLOBAL_DIR']!;
		fs.mkdirSync(globalDir, {recursive: true});
		fs.writeFileSync(path.join(globalDir, 'recent-projects.json'), 'nope');

		expect(getOpenProjectModifiers()).toEqual([]);
	});
});

describe(':open validation', () => {
	it('asks for a target and completes against the list', () => {
		const root = makeProject('p');
		recordRecentProject({root, now: 1});

		const result = cmdValidation[CmdKeywords.OPEN].validate(
			CmdKeywords.OPEN,
			'',
			'',
		);

		expect(result.validity).toBe(cmdValidity.Invalid);
		expect(result.message).toContain('number from the list');
		expect(result.completionWordList).toEqual(['1', root]);
	});

	it('asks for a path when there is no list', () => {
		const result = cmdValidation[CmdKeywords.OPEN].validate(
			CmdKeywords.OPEN,
			'',
			'',
		);

		expect(result.validity).toBe(cmdValidity.Invalid);
		expect(result.message).toContain('path');
		expect(result.completionWordList).toEqual([]);
	});

	it('is confirmable once a listed number is typed', () => {
		const result = cmdValidation[CmdKeywords.OPEN].validate(
			CmdKeywords.OPEN,
			'1',
			'',
		);

		expect(result.validity).toBe(cmdValidity.Valid);
	});

	// The parser only promotes a word to `modifier` when it is in the completion
	// list, so a path or an unlisted number arrives as `inputString`.
	it.each(['7', '/some/where', '~/dev/x'])(
		'is confirmable once %s is typed as free input',
		inputString => {
			const result = cmdValidation[CmdKeywords.OPEN].validate(
				CmdKeywords.OPEN,
				'',
				inputString,
			);

			expect(result.validity).toBe(cmdValidity.Valid);
		},
	);
});
