// Bundles the epiq workflow skill into the MCP server, so `epiq_skill_install`
// can write it into a project from the published package, which ships only
// `dist`. Regenerated on every build; a unit test fails when the committed
// output lags the skill file.
import fs from 'node:fs';

const skillFile = new URL('../../.claude/skills/epiq/SKILL.md', import.meta.url);
const outFile = new URL('../mcp/skill-content.ts', import.meta.url);

const skill = fs.readFileSync(skillFile, 'utf-8');

const content = `// Auto-generated from .claude/skills/epiq/SKILL.md by write-skill.mjs. Do not edit.
export const EPIQ_SKILL_PATH = '.claude/skills/epiq/SKILL.md';
export const EPIQ_SKILL = ${JSON.stringify(skill)};
`;

fs.writeFileSync(outFile, content);

console.log(`Wrote skill-content.ts from ${skill.length} characters of SKILL.md`);
