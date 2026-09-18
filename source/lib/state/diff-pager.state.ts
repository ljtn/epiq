import {useSyncExternalStore} from 'react';
import {PatchRow} from '../commits/patch-parse.js';
import {getState} from './state.js';

// What the diff pager has open and what is selected in it — the state the key
// handlers and the component both need, and which neither of them owns.

/**
 * The patch the pager currently has open.
 *
 * The pager fetches it; the key handlers, which run outside React, need the
 * same rows to work out what a keystroke selected. Kept here rather than
 * re-read from git on every keypress, and replaced wholesale when another
 * commit is opened.
 */
let openPatch: {sha: string; rows: PatchRow[]} | null = null;

/**
 * Where a range being selected starts.
 *
 * A range has two ends and the terminal has one cursor, so the first is marked
 * and held while the second is moved to. Carries its sha because the pager
 * survives a change of commit: a mark left on another commit's patch would
 * otherwise anchor a comment to a line nobody is looking at.
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

/**
 * The commit whose patch the cursor is in, or null anywhere else.
 *
 * A commit node carries its sha as its id and sits under the ticket's Diff
 * field, so being inside one is a question about the context node's parent.
 */
export const openPagerSha = (): string | null => {
	const {contextNode} = getState();

	// Asked of the patch itself rather than of the node's shape: only the
	// mounted pager sets this, and it sets it to the commit it is showing. A
	// ticket that happens to be *called* "Diff" would satisfy any test written
	// against titles, and its comments would then be read for a line anchor.
	return openPatch && openPatch.sha === contextNode.id ? contextNode.id : null;
};
