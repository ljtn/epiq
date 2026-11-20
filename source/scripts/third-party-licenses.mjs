// Writes the license of every package an esbuild bundle took code from, as their licenses require.
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const packageDir = input => {
	const parts = input.split('/');
	const at = parts.lastIndexOf('node_modules');
	if (at < 0) return undefined;
	const length = parts[at + 1]?.startsWith('@') ? 3 : 2;
	return parts.slice(0, at + length).join('/');
};

const licenseText = dir => {
	const file = readdirSync(dir).find(name =>
		/^(licen[cs]e|copying)(\.|-|$)/i.test(name),
	);
	return file ? readFileSync(join(dir, file), 'utf8').trim() : undefined;
};

export const writeThirdPartyLicenses = (root, metafile, outFile) => {
	const dirs = new Set(
		Object.keys(metafile.inputs).map(packageDir).filter(Boolean),
	);
	const entries = new Map();

	for (const dir of dirs) {
		const manifest = resolve(root, dir, 'package.json');
		if (!existsSync(manifest)) continue;
		const {name, version, license} = JSON.parse(readFileSync(manifest, 'utf8'));
		const text =
			licenseText(resolve(root, dir)) ?? `License: ${license ?? 'unknown'}`;
		entries.set(`${name}@${version}`, text);
	}

	const body = [...entries]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([id, text]) => `${id}\n${'-'.repeat(id.length)}\n${text}\n`)
		.join('\n');
	writeFileSync(outFile, body);
	return entries.size;
};
