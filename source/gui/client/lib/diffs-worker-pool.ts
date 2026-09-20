// Where the diff highlighter runs.
//
// `MultiFileDiff` tokenizes on whichever thread it is given. Given none, that
// is the main one, and a commit is as much work as it has text: 118 files and
// 1.7 million characters of source took 5.6 s during which nothing else on the
// page could happen. Handed a pool, it tokenizes there and the board stays
// responsive while the diff fills in.
//
// The worker body comes from `@pierre/diffs`. What the package cannot ship is
// a URL the browser can fetch, so `build-gui.mjs` builds its body as a second
// entry point beside `main.js`, under the name below.

import {useSyncExternalStore} from 'react';
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

// Whether the pool is somewhere a diff can actually be drawn.
//
// It has to be asked, because the library does not: a worker that fails to
// load logs one line and leaves its `initialize` task unsettled forever, so
// the pool never reports itself broken, never drains its queue, and every diff
// stays blank — where before there was a pool at all, the same failure simply
// drew on the main thread. A stale `dist/gui` with no `diffs-worker.js` in it
// and a browser that will not take a module worker both land here.
//
// One flag for the page rather than one per diff, since the workers start when
// the board does and a diff is opened long afterwards; by the time a reader
// asks for one, this has already been decided.
let workersUsable = true;

const listeners = new Set<() => void>();

const markWorkersUnusable = (): void => {
	if (!workersUsable) return;

	workersUsable = false;
	for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
};

const read = (): boolean => workersUsable;

/** Re-renders the diffs when the pool turns out not to be one. */
export const useDiffWorkersUsable = (): boolean =>
	useSyncExternalStore(subscribe, read, read);

export const DIFF_WORKER_POOL_OPTIONS = {
	workerFactory: () => {
		const worker = new Worker(WORKER_URL, {type: 'module'});

		// The pool's own handler for this only logs. A worker that cannot be
		// fetched or parsed raises it before it has run a line.
		worker.addEventListener('error', markWorkersUnusable);

		return worker;
	},
	poolSize: poolSize(),
};

// The theme the pool's highlighter loads with. The same name the components
// ask for, and registered on the main thread by `diff-theme`, which the pool
// resolves there and ships to each worker as an object rather than a name.
export const DIFF_WORKER_HIGHLIGHTER_OPTIONS = {
	theme: EPIQ_DIFF_THEME,
};
