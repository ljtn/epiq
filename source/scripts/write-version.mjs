import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(
	fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
);

const outFile = new URL('../version.ts', import.meta.url);

const content = `// Auto-generated. Do not edit.
export const EPIQ_VERSION = '${pkg.version}';
`;

fs.writeFileSync(outFile, content);

console.log(`Wrote version.ts with version ${pkg.version}`);
