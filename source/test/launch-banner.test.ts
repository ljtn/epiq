import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {launchBanner} from '../gui/launch-banner.js';

const url = 'http://epiq.localhost:50972';
const home = os.homedir();

const banner = (repoRoot: string, reused = false) =>
	launchBanner({url, repoRoot, version: '1.12.0', reused});

describe('the gui launch banner', () => {
	let level: typeof chalk.level;

	beforeAll(() => {
		level = chalk.level;
		chalk.level = 0;
	});

	afterAll(() => {
		chalk.level = level;
	});

	it('names the url, the version and the project', () => {
		const text = banner(path.join(home, 'dev', 'epiq'));

		expect(text).toContain(`Local    ${url}`);
		expect(text).toContain('v1.12.0');
		expect(text).toContain(`Project  ~${path.sep}dev${path.sep}epiq`);
	});

	it('shortens only a path inside home, not one that merely starts with it', () => {
		const sibling = home + 'x' + path.sep + 'epiq';

		expect(banner(sibling)).toContain(`Project  ${sibling}`);
	});

	it('says how to stop a server it started, and that a reused one was opened', () => {
		expect(banner(home)).toContain('press ctrl+c to stop');
		expect(banner(home, true)).toContain('already running for this project');
		expect(banner(home, true)).not.toContain('ctrl+c');
	});
});
