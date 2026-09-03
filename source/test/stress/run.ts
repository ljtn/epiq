// Ten years of a twenty-person board, replayed through the real loader and the
// real materializer, then served so it can be used rather than only measured.
//
// Opt-in. Nothing runs this but `npm run stress`, and nothing depends on it.
//
//   npm run stress                      # in a container, the default
//   npx tsx source/test/stress/run.ts  # on this machine, if you insist
//
// Env: STRESS_EVENTS, STRESS_ACTORS, STRESS_YEARS, STRESS_SERVE, STRESS_DIR.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {generateLog} from './generate-log.js';

// Empty is unset, not zero: the container passes every variable through
// whether or not it was given one, so `?? fallback` sees '' and Number('') is
// 0 — which ran the whole thing over an empty board and reported it happily.
const number = (name: string, fallback: number) => {
	const raw = process.env[name];
	const parsed = raw ? Number(raw) : Number.NaN;

	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Twenty people for ten years, at the ~400 events per person-month this board
// has actually seen.
const ACTORS = number('STRESS_ACTORS', 20);
const YEARS = number('STRESS_YEARS', 10);
const EVENTS = number('STRESS_EVENTS', ACTORS * YEARS * 12 * 400);
const SERVE = process.env['STRESS_SERVE'] !== 'false';

const ROOT =
	process.env['STRESS_DIR'] ??
	fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-stress-'));

// The checkout, remembered before anything changes directory into the scratch
// project: the GUI server resolves its assets against the working directory,
// so serving from inside the project would look for dist/gui in there.
const CHECKOUT = process.cwd();

const REPO = path.join(ROOT, 'repo');
const GLOBAL = path.join(ROOT, 'global');

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const secs = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

const step = async <T>(label: string, fn: () => T | Promise<T>): Promise<T> => {
	const t0 = performance.now();
	const value = await fn();
	const took = performance.now() - t0;
	const heap = process.memoryUsage();

	console.log(
		`  ${label.padEnd(38)} ${secs(took).padStart(9)}   ` +
			`heap ${mb(heap.heapUsed).padStart(7)}   rss ${mb(heap.rss).padStart(7)}`,
	);

	return value;
};

console.log(
	`\n  ${EVENTS.toLocaleString()} events — ${ACTORS} people, ${YEARS} years`,
);

fs.rmSync(REPO, {recursive: true, force: true});
fs.mkdirSync(REPO, {recursive: true});
fs.mkdirSync(GLOBAL, {recursive: true});

process.env['EPIQ_GLOBAL_DIR'] = GLOBAL;
process.env['IS_LOCAL'] = 'true';

fs.writeFileSync(
	path.join(GLOBAL, 'config.json'),
	JSON.stringify({
		logLevel: 'error',
		userId: 'u-000',
		userName: 'person000',
		preferredEditor: 'vim',
		autoSync: false,
	}),
);

const git = (args: string) =>
	execSync(`git ${args}`, {cwd: REPO, stdio: 'ignore'});

git('init -b main');
git('config user.email stress@example.com');
git('config user.name Stress');
fs.writeFileSync(path.join(REPO, 'readme.md'), '# stress\n');
git('add -A');
git('commit -m "stress"');

process.chdir(REPO);

// commands.ts first: the init command sits in an import cycle with it.
await import('../../lib/command-line/commands.js');
const {createDefaultEvents} = await import('../../lib/event/event-boot.js');
const {materializeAll, partitionMaterializeResults} = await import(
	'../../lib/event/event-materialize.js'
);
const {patchSettingsState} = await import('../../lib/state/settings.state.js');
const {initCommand} = await import(
	'../../lib/command-line/commands/init.cmd.js'
);

patchSettingsState({
	userId: 'u-000',
	userName: 'person000',
	preferredEditor: 'vim',
	autoSync: false,
});

const defaults = createDefaultEvents({userId: 'u-000', userName: 'person000'});
if (defaults.status === 'fail') throw new Error(defaults.message);
materializeAll(defaults.value ?? []);

const init = await initCommand();
if (init.status === 'fail') throw new Error(`init: ${init.message}`);

// What the GUI and the MCP server both do before replaying anything: nothing
// they send reads a ticket's virtual fields, and building them is most of the
// cost of a replay. Left on, this measures a path neither of them takes — the
// TUI's. STRESS_VIRTUAL=on measures that one instead.
const {setVirtualNodesEnabled} = await import(
	'../../lib/virtual-nodes/virtual-nodes.js'
);

const VIRTUAL = process.env['STRESS_VIRTUAL'] === 'on';
setVirtualNodesEnabled(VIRTUAL);

const api = await import('../../mcp/epiq-api.js');
const {getStateBranchRoot} = await import('../../git/git-storage.js');

const ok = <T>(result: {status: string; message: string; value?: T}): T => {
	if (result.status === 'fail') throw new Error(result.message);
	return result.value as T;
};

// A real board, real lanes and real tags, so the generated events hang off
// nodes that exist rather than ids nothing resolves.
const boards = ok(await api.listBoards({repoRoot: REPO})) as {id: string}[];
const boardId = boards[0]!.id;

for (const title of ['Review', 'Blocked']) {
	ok(await api.createSwimlane({repoRoot: REPO, title, boardId}));
}

const lanes = ok(await api.listSwimlanes({repoRoot: REPO})) as {id: string}[];

const stateRoot = ok(getStateBranchRoot({repoRoot: REPO}));
if (!stateRoot) throw new Error('no state branch root');

console.log(
	`  virtual nodes ${
		VIRTUAL ? 'on  (the TUI\u2019s replay)' : 'off (what the GUI and MCP do)'
	}\n`,
);

await step('generate the log', () =>
	generateLog({
		stateRoot,
		boardId,
		laneIds: lanes.map(lane => lane.id),
		actors: Array.from({length: ACTORS}, (_, i) => ({
			userId: `u-${String(i).padStart(3, '0')}`,
			userName: `person${String(i).padStart(3, '0')}`,
		})),
		events: EVENTS,
		years: YEARS,
		tagNames: ['gui', 'bug', 'feature', 'sync', 'crdt', 'testing'],
		// STRESS_SHAPE=add.issue,move.node narrows the log to those actions, which
		// is how a slow handler is found: time one kind at two sizes.
		shape: process.env['STRESS_SHAPE']?.split(','),
	}),
);

const eventsDir = path.join(stateRoot, '.epiq', 'events');
const onDisk = fs
	.readdirSync(eventsDir)
	.filter(file => file.endsWith('.jsonl'))
	.reduce((sum, file) => sum + fs.statSync(path.join(eventsDir, file)).size, 0);

console.log(`  ${'log on disk'.padEnd(38)} ${mb(onDisk).padStart(9)}\n`);

const {loadMergedEvents} = await import('../../lib/event/event-load.js');
const {getEventTimeline} = await import('../../mcp/epiq-time-travel.js');

const loaded = await step('load, parse and order the log', () => {
	const result = loadMergedEvents(stateRoot);
	if (result.status === 'fail' || !result.value) {
		throw new Error(result.message);
	}
	return result.value;
});

console.log(
	`  ${'events loaded'.padEnd(38)} ${loaded.length
		.toLocaleString()
		.padStart(9)}`,
);

const materialized = await step('replay it (materializeAll)', () =>
	materializeAll(loaded),
);

// The number that decides whether any of this counts. An event the replay
// skipped never became board state, so a run that reports a fast timeline over
// a log it could not apply has measured nothing.
const {fatal, skipped} = partitionMaterializeResults(materialized ?? []);

console.log(
	`  ${'events skipped on replay'.padEnd(38)} ${String(skipped.length).padStart(
		9,
	)}` + (skipped.length > 0 ? '   <-- these never became board state' : ''),
);
console.log(
	`  ${'events fatal on replay'.padEnd(38)} ${String(fatal.length).padStart(
		9,
	)}` + (fatal.length > 0 ? '   <-- the log is not valid' : ''),
);

if (fatal.length > 0) {
	console.log(`\n  first fatal: ${fatal[0]?.message}\n`);
}

// Grouped, because "600 skipped" says something is wrong and nothing about
// what: a skip is a precondition the log did not meet, and they come in kinds.
const reasons = new Map<string, number>();

for (const failure of [...skipped, ...fatal]) {
	const kind = (failure.message ?? '')
		.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, '<id>')
		.slice(0, 70);

	reasons.set(kind, (reasons.get(kind) ?? 0) + 1);
}

for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
	console.log(`      ${String(count).padStart(7)}  ${reason}`);
}

console.log('');

// Cold: the index does not exist yet, so this pays for the whole derivation.
const cold = await step('timeline, cold (builds the index)', () =>
	getEventTimeline({repoRoot: REPO, boardId}),
);

if (cold.status === 'fail' || !cold.value) throw new Error(cold.message);

console.log(
	`  ${'events in the window'.padEnd(38)} ` +
		`${cold.value.events.length.toLocaleString().padStart(9)}` +
		(cold.value.events.length === 0 ? '   <-- past the 20k payload cap' : ''),
);

// Warm: what a drag of the needle actually costs, which is the thing under
// test. Ten of them, since one is too small to read.
const t0 = performance.now();
for (let i = 0; i < 10; i++) {
	const end = Date.now() - i * 24 * 60 * 60 * 1000;
	await getEventTimeline({
		repoRoot: REPO,
		boardId,
		start: end - 30 * 24 * 60 * 60 * 1000,
		end,
	});
}
const perRequest = (performance.now() - t0) / 10;

console.log(
	`  ${'timeline, warm (per request)'.padEnd(38)} ` +
		`${perRequest.toFixed(1).padStart(6)} ms`,
);

console.log(
	`\n  peak rss ${mb(process.memoryUsage().rss)}   ` + `project at ${REPO}\n`,
);

if (!SERVE) process.exit(0);

// Back to the checkout before the import, not after: the server resolves its
// asset root once, in a top-level const, as the module is evaluated. Changing
// directory afterwards leaves it looking for dist/gui inside the scratch
// project, where it answers every request with a 404.
process.chdir(CHECKOUT);

const {startGuiServer} = await import('../../gui/api/api-server.js');

// Binds 127.0.0.1 by design; `npm run stress` forwards it out of the
// container rather than the server learning about containers.
const served = await startGuiServer({repoRoot: REPO, boardId: ''});
if (served.status === 'fail' || !served.value) throw new Error(served.message);

const address = served.value.server.address() as {port: number};
console.log(`  the board, at this size:  http://127.0.0.1:${address.port}\n`);
