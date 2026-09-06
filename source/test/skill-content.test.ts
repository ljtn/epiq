import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {EPIQ_SKILL, EPIQ_SKILL_PATH} from '../mcp/skill-content.js';

// The bundled copy is what `epiq_skill_install` writes into other projects, so
// an edit to the skill that is not regenerated would ship the old rules.
describe('bundled skill', () => {
	it('matches the skill file in this repository', () => {
		const onDisk = fs.readFileSync(
			path.join(process.cwd(), EPIQ_SKILL_PATH),
			'utf8',
		);

		expect(EPIQ_SKILL).toBe(onDisk);
	});
});
