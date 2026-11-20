// Compares `bench.ts` runs of a PR with runs of main on the same runner, and
// fails on a substantial regression. Args: <main dir> <pr dir>, each holding
// one JSON file per run. Writes a table to GITHUB_STEP_SUMMARY when set.

import fs from 'node:fs';
import path from 'node:path';

// Slower by this ratio, and by at least the floor: runners are noisy, and a
// 1 ms read doubling is not a regression anyone feels.
const MAX_RATIO = 1.3;
const FLOOR_MS = 50;
const FLOOR_MB = 100;

const [baseDir, headDir] = process.argv.slice(2);
if (!baseDir || !headDir) throw new Error('usage: <main dir> <pr dir>');

const runsIn = (dir: string): Array<Record<string, number>> =>
	fs.existsSync(dir)
		? fs
				.readdirSync(dir)
				.filter(file => file.endsWith('.json'))
				.map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
		: [];

const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

const base = runsIn(baseDir);
const head = runsIn(headDir);
if (head.length === 0) throw new Error('no PR runs');

const show = (name: string, value: number) =>
	name.includes('(MB)') ? `${value.toFixed(0)} MB` : `${value.toFixed(1)} ms`;

const lines = ['| | main | this PR | change |', '|---|---:|---:|---:|'];
const regressions: string[] = [];

for (const name of Object.keys(head[0]!)) {
	const now = median(head.map(run => run[name]!));
	const before = base.length ? median(base.map(run => run[name]!)) : null;
	if (before === null) {
		lines.push(`| ${name} | — | ${show(name, now)} | |`);
		continue;
	}

	const ratio = before > 0 ? now / before : 1;
	const floor = name.includes('(MB)') ? FLOOR_MB : FLOOR_MS;
	const regressed = ratio > MAX_RATIO && now - before > floor;
	if (regressed) regressions.push(name);

	const change = `${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%`;
	lines.push(
		`| ${name} | ${show(name, before)} | ${show(name, now)} | ${change}${
			regressed ? ' ❌' : ''
		} |`,
	);
}

const verdict =
	base.length === 0
		? 'No baseline: main could not run this benchmark, so nothing is compared.'
		: regressions.length > 0
		? `Slower than main by more than ${Math.round(
				(MAX_RATIO - 1) * 100,
		  )}%: ${regressions.join(', ')}.`
		: `Nothing is more than ${Math.round(
				(MAX_RATIO - 1) * 100,
		  )}% slower than main.`;

const report = [
	`### Performance against main`,
	'',
	`Median of ${head.length} runs each, same runner.`,
	'',
	...lines,
	'',
	verdict,
].join('\n');

console.log(report);
// Shown on the run, not only in its log: a comparison that never ran is no pass.
if (base.length === 0) console.log(`::warning::${verdict}`);
const summary = process.env['GITHUB_STEP_SUMMARY'];
if (summary) fs.appendFileSync(summary, report + '\n');

process.exit(regressions.length > 0 ? 1 : 0);
