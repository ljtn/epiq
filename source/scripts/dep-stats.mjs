// Dependency footprint from package-lock.json: what `npm i epiq` installs, and what a dev install does.
import fs from 'node:fs';

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages;
const root = lock[''];
const entries = Object.entries(lock).filter(([k]) => k !== '');

const resolve = (from, name) => {
	let base = from;
	for (;;) {
		const key = (base ? base + '/' : '') + 'node_modules/' + name;
		if (lock[key]) return key;
		if (!base) return undefined;
		const i = base.lastIndexOf('/node_modules/');
		base = i < 0 ? '' : base.slice(0, i);
	}
};

const closure = starts => {
	const seen = new Set();
	const stack = [...starts];
	while (stack.length > 0) {
		const key = stack.pop();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		const pkg = lock[key];
		for (const dep of Object.keys({
			...pkg.dependencies,
			...pkg.optionalDependencies,
		}))
			stack.push(resolve(key, dep));
	}
	return seen;
};

const direct = Object.keys(root.dependencies ?? {});
const shipped = closure(direct.map(d => 'node_modules/' + d));
const names = keys =>
	new Set([...keys].map(k => k.slice(k.lastIndexOf('node_modules/') + 13)));
const scripts = keys => [...keys].filter(k => lock[k].hasInstallScript);

const stats = {
	'npm i epiq: direct dependencies': direct.length,
	'npm i epiq: packages installed': names(shipped).size,
	'npm i epiq: with install scripts': names(scripts(shipped)).size,
	'dev: direct dependencies':
		direct.length + Object.keys(root.devDependencies ?? {}).length,
	'dev: packages installed': names(entries.map(([k]) => k)).size,
	'dev: with install scripts': names(scripts(entries.map(([k]) => k))).size,
};

const perDirect = direct
	.map(d => [d, closure(['node_modules/' + d]).size - 1])
	.sort((a, b) => b[1] - a[1]);

console.log(
	JSON.stringify({stats, perDirect: Object.fromEntries(perDirect)}, null, 2),
);
