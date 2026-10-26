import {useSyncExternalStore} from 'react';
import {PatchRow} from '../commits/patch-parse.js';
import {getState} from './state.js';

// What the diff pager has open and what is selected in it — the state the key
// handlers and the component both need, and which neither of them owns.

/** The patch the pager has open, for key handlers that run outside React. */
let openPatch: {sha: string; rows: PatchRow[]} | null = null;

/**
 * Where a range being selected starts. Carries its sha, so a mark on another
 * commit's patch never anchors a comment.
 */
let mark: {sha: string; row: number} | null = null;

const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of listeners) listener();
};

export const setOpenPatch = (
	next: {sha: string; rows: PatchRow[]} | null,
): void => {
	openPatch = next;
	emit();
};

export const getOpenPatch = (): {sha: string; rows: PatchRow[]} | null =>
	openPatch;

// useSyncExternalStore compares snapshots by identity, so the object handed to
// it is rebuilt here, where the mark changes, and nowhere else.
let snapshot: {mark: {sha: string; row: number} | null} = {mark: null};

export const setDiffMark = (next: {sha: string; row: number} | null): void => {
	mark = next;
	snapshot = {mark: next};
	emit();
};

export const getDiffMark = (): {sha: string; row: number} | null => mark;

// The mark for this commit, and nothing for one left on another.
export const diffMarkFor = (sha: string): number | null =>
	mark && mark.sha === sha ? mark.row : null;

export const useDiffPagerState = (): {
	mark: {sha: string; row: number} | null;
} =>
	useSyncExternalStore(
		callback => {
			listeners.add(callback);

			return () => {
				listeners.delete(callback);
			};
		},
		() => snapshot,
	);

/** The commit whose patch the cursor is in, or null anywhere else. */
export const openPagerSha = (): string | null => {
	const {contextNode} = getState();

	// Asked of the mounted patch, not the node's shape: a ticket titled "Diff"
	// would pass a title test.
	return openPatch && openPatch.sha === contextNode.id ? contextNode.id : null;
};
