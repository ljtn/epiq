import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {isFail} from '../../lib/model/result-types.js';
import {installSkill} from '../epiq-skill.js';
import {EPIQ_SKILL, EPIQ_SKILL_PATH} from '../skill-content.js';
import {
	cloneRepo,
	initBareRepo,
	makeTempDir,
	useTempHome,
} from '../../test/helpers/git-repo.js';

useTempHome();

const setupPlainRepo = async () => {
	const remoteRoot = makeTempDir();
	const repoRoot = makeTempDir();

	await initBareRepo(remoteRoot);
	await cloneRepo({remoteRoot, cloneRoot: repoRoot});

	return repoRoot;
};

describe('epiq_skill_install', () => {
	it('writes the bundled skill where the harness reads it', async () => {
		const repoRoot = await setupPlainRepo();

		const result = await installSkill({repoRoot});
		if (isFail(result)) throw new Error(result.message);

		const skillPath = path.join(repoRoot, EPIQ_SKILL_PATH);
		expect(result.value.written).toBe(true);
		expect(fs.readFileSync(skillPath, 'utf8')).toBe(EPIQ_SKILL);
		expect(fs.readFileSync(skillPath, 'utf8')).toMatch(/^---\nname: epiq\n/);
	});

	it('leaves an identical file alone', async () => {
		const repoRoot = await setupPlainRepo();
		await installSkill({repoRoot});

		const result = await installSkill({repoRoot});
		if (isFail(result)) throw new Error(result.message);

		expect(result.value.written).toBe(false);
	});

	it('refuses to overwrite a differing file unless forced', async () => {
		const repoRoot = await setupPlainRepo();
		const skillPath = path.join(repoRoot, EPIQ_SKILL_PATH);
		fs.mkdirSync(path.dirname(skillPath), {recursive: true});
		fs.writeFileSync(skillPath, '# local edits\n', 'utf8');

		const refused = await installSkill({repoRoot});
		expect(isFail(refused)).toBe(true);
		expect(refused.message).toContain('force');
		expect(fs.readFileSync(skillPath, 'utf8')).toBe('# local edits\n');

		const forced = await installSkill({repoRoot, force: true});
		if (isFail(forced)) throw new Error(forced.message);
		expect(forced.value.written).toBe(true);
		expect(fs.readFileSync(skillPath, 'utf8')).toBe(EPIQ_SKILL);
	});

	it('fails outside a git repository', async () => {
		const result = await installSkill({repoRoot: makeTempDir()});

		expect(isFail(result)).toBe(true);
	});
});
