import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
	NO_PROJECT_MESSAGE,
	resolveClosestEpiqProjectRoot,
} from '../lib/storage/paths.js';
import {isFail} from '../lib/model/result-types.js';

// The GUI decides whether to show the init screen by comparing against this
// exact message, so the two have to stay in step.

let dir = '';

afterEach(() => {
	if (dir) fs.rmSync(dir, {recursive: true, force: true});
});

describe('resolveClosestEpiqProjectRoot', () => {
	it('fails with the message the init screen is keyed on', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-no-project-'));

		const result = resolveClosestEpiqProjectRoot(dir);

		expect(isFail(result)).toBe(true);
		expect(result.message).toBe(NO_PROJECT_MESSAGE);
	});
});
