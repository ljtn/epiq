// Times what users wait on, in a fresh process, over a board `run.ts` left in
// STRESS_DIR. CI runs this same file on the PR and on main and compares
// (`compare-bench.ts`). Env: BENCH_DIR (a copy of STRESS_DIR), BENCH_OUT.
// Uses only the public API and the loader, so it runs against either build.

import fs from 'node:fs';
import path from 'node:path';
import {ulid} from 'ulid';

const DIR = process.env['BENCH_DIR'];
const OUT = process.env['BENCH_OUT'];
if (!DIR || !OUT) throw new Error('BENCH_DIR and BENCH_OUT are required');

const REPO = path.join(DIR, 'repo');
process.env['EPIQ_GLOBAL_DIR'] = path.join(DIR, 'global');
process.env['IS_LOCAL'] = 'true';
process.chdir(REPO);

const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

const timed = async (fn: () => unknown): Promise<number> => {
	const t0 = performance.now();
	await fn();
	return performance.now() - t0;
};

const repeated = async (times: number, fn: () => unknown) => {
	const runs: number[] = [];
	for (let index = 0; index < times; index++) runs.push(await timed(fn));
	return median(runs);
};

const ok = <T>(result: {status: string; message: string; value?: T}): T => {
	if (result.status === 'fail') throw new Error(result.message);
	return result.value as T;
};

// commands.ts first: the init command sits in an import cycle with it.
await import('../../lib/command-line/commands.js');
const {setVirtualNodesEnabled} = await import(
	'../../lib/virtual-nodes/virtual-nodes.js'
);
setVirtualNodesEnabled(false);
const api = await import('../../mcp/epiq-api.js');
const {getEdgeRef} = await import('../../lib/board/board-log.js');
const {getState} = await import('../../lib/state/state.js');
const {nodeRef} = await import('../../lib/utils/node-ref.js');
const {getStateBranchRoot} = await import('../../git/git-storage.js');
const {checkoutStateAt, returnToLive} = await import(
	'../../mcp/epiq-time-travel.js'
);

const input = {repoRoot: REPO};
const metrics: Record<string, number> = {};

// A new agent's first call: read, order and replay the whole log.
metrics['first read (cold boot)'] = await timed(async () =>
	ok(await api.listIssues({...input, brief: true})),
);
metrics['list tickets'] = await repeated(5, async () =>
	ok(await api.listIssues({...input, brief: true})),
);

// An open ticket in a lane that takes writes, not the Closed one.
const {nodes} = getState();
const tickets = Object.values(nodes).filter(
	node =>
		node.context === 'TICKET' &&
		!node.isDeleted &&
		!nodes[node.parentNodeId ?? '']?.readonly,
);
const ticket = tickets[Math.floor(tickets.length / 2)]!;
const lane = ticket.parentNodeId!;
const boardId = (nodes[lane]?.parentNodeId ?? '') as string;

metrics['ticket by ref'] = await repeated(20, async () =>
	ok(await api.getIssue({...input, idOrRef: nodeRef(ticket.id)})),
);
metrics['board overview'] = await repeated(5, () =>
	ok(api.getBoardOverview({boardId})),
);
metrics['GUI board state'] = await repeated(3, async () =>
	ok(await api.getGuiState(input)),
);

// Own write, then the read after it.
metrics['file a ticket'] = await timed(async () =>
	ok(await api.createIssue({...input, title: 'bench', parentId: lane})),
);
metrics['read after own write'] = await timed(async () =>
	ok(await api.listIssues({...input, brief: true})),
);

// A teammate's event lands in their log, as a sync brings it.
const stateRoot = ok(getStateBranchRoot(input)) as string;
const eventsDir = path.join(stateRoot, '.epiq', 'events');
const teammate = fs
	.readdirSync(eventsDir)
	.find(file => file.startsWith('u-001.') && file.endsWith('.jsonl'));
if (!teammate) throw new Error('no teammate log');
const edge = ok(getEdgeRef(stateRoot));
fs.appendFileSync(
	path.join(eventsDir, teammate),
	JSON.stringify({
		'edit.title': {id: ticket.id, name: 'teammate'},
		v: 1,
		id: edge ? [ulid(), edge] : [ulid()],
	}) + '\n',
);
metrics['read after teammate write'] = await timed(async () =>
	ok(await api.listIssues({...input, brief: true})),
);

// Scrubbing the timeline: one step, a step a day later, then back to live.
const year = 365 * 24 * 60 * 60 * 1000;
const halfway = Date.now() - 5 * year;
metrics['first scrub step'] = await timed(async () =>
	ok(await checkoutStateAt({...input, targetTime: halfway})),
);
metrics['next scrub step'] = await timed(async () =>
	ok(
		await checkoutStateAt({
			...input,
			targetTime: halfway + 24 * 60 * 60 * 1000,
		}),
	),
);
metrics['return to live'] = await timed(async () =>
	ok(await returnToLive(input)),
);

metrics['peak rss (MB)'] = process.resourceUsage().maxRSS / 1024;

fs.writeFileSync(OUT, JSON.stringify(metrics));
process.exit(0);
