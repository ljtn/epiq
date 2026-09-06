import fs from 'node:fs';
import path from 'node:path';
import {getRepoRootDir} from '../git/git-storage.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {EPIQ_SKILL, EPIQ_SKILL_PATH} from './skill-content.js';

type InstallSkillInput = {
	repoRoot?: string;
	force?: boolean;
};

/**
 * Writes the epiq workflow skill into the repository, where an agent's harness
 * picks it up. The text ships inside the server, so a project set up from an
 * agent gets the same rules as this repository's own copy. Never boots: a
 * repository gets its skill before or after it gets its board.
 */
export const installSkill = async (
	input: InstallSkillInput = {},
): Promise<Result<{path: string; written: boolean}>> => {
	const repoRootResult = await getRepoRootDir(input.repoRoot ?? process.cwd());
	if (isFail(repoRootResult)) return failed(repoRootResult.message);

	const skillPath = path.join(repoRootResult.value, EPIQ_SKILL_PATH);

	if (fs.existsSync(skillPath)) {
		const existing = fs.readFileSync(skillPath, 'utf8');

		if (existing === EPIQ_SKILL) {
			return succeeded('Skill already installed and up to date', {
				path: skillPath,
				written: false,
			});
		}

		if (!input.force) {
			return failed(
				`${EPIQ_SKILL_PATH} already exists and differs from the bundled skill. Pass force:true to overwrite it.`,
			);
		}
	}

	try {
		fs.mkdirSync(path.dirname(skillPath), {recursive: true});
		fs.writeFileSync(skillPath, EPIQ_SKILL, 'utf8');
	} catch (error) {
		return failed(
			error instanceof Error
				? `Failed to write ${EPIQ_SKILL_PATH}: ${error.message}`
				: `Failed to write ${EPIQ_SKILL_PATH}`,
		);
	}

	return succeeded(`Installed skill at ${EPIQ_SKILL_PATH}`, {
		path: skillPath,
		written: true,
	});
};
