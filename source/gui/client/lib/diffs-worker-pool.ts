// Where the diff highlighter runs.
//
// `MultiFileDiff` tokenizes on whichever thread it is given. Given none, that
// is the main one, and a commit is as much work as it has text: 118 files and
// 1.7 million characters of source took 5.6 s during which nothing else on the
// page could happen. Handed a pool, it tokenizes there and the board stays
// responsive while the diff fills in.
//
// The worker body comes from `@pierre/diffs`; `client/diffs-worker.ts` is the
// entry `build-gui.mjs` builds it under, so there is a URL to point at.

import {EPIQ_DIFF_THEME} from './diff-theme';

// Served from the GUI root, beside main.js — see `serveStatic`.
const WORKER_URL = '/diffs-worker.js';

// Enough to overlap a commit's files, not so many that each one's grammar
// loading costs more than the tokenizing it saves. The library's own default
// is 8, which on a four-core laptop is mostly workers waiting for a core.
const poolSize = (): number => {
	const cores = globalThis.navigator?.hardwareConcurrency ?? 4;

	return Math.max(2, Math.min(4, cores - 1));
};

export const DIFF_WORKER_POOL_OPTIONS = {
	workerFactory: () => new Worker(WORKER_URL, {type: 'module'}),
	poolSize: poolSize(),
};

// The theme the pool's highlighter loads with. The same name the components
// ask for, and registered on the main thread by `diff-theme`, which the pool
// forwards to its workers as a custom extension.
export const DIFF_WORKER_HIGHLIGHTER_OPTIONS = {
	theme: EPIQ_DIFF_THEME,
};
