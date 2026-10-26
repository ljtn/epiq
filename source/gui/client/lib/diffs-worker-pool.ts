// Runs the diff highlighter off the main thread, so a large commit never
// freezes the page. `build-gui.mjs` builds the worker as a second entry point.

import {useSyncExternalStore} from 'react';
import {EPIQ_DIFF_THEME} from './diff-theme';

// Served from the GUI root, beside main.js — see `serveStatic`.
const WORKER_URL = '/diffs-worker.js';

// Enough to overlap a commit's files; more just wait for a core.
const poolSize = (): number => {
	const cores = globalThis.navigator?.hardwareConcurrency ?? 4;

	return Math.max(2, Math.min(4, cores - 1));
};

// Whether the pool can draw. A worker that fails to load never settles, so
// the pool must be told; one flag for the page.
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

// Registered on the main thread by `diff-theme` and shipped to each worker.
export const DIFF_WORKER_HIGHLIGHTER_OPTIONS = {
	theme: EPIQ_DIFF_THEME,
};
