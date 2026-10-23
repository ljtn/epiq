import {DiffFileInput, FileContents} from '@pierre/diffs/react';
import {GuiCommitDiffFile} from './gui-state.model';

// FNV-1a over the text, beside its length: a collision needs two versions of
// one path at the same length, hashing alike.
const contentHash = (contents: string): string => {
	let hash = 0x811c9dc5;

	for (let i = 0; i < contents.length; i++) {
		hash ^= contents.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}

	return `${contents.length.toString(36)}.${hash.toString(36)}`;
};

// The worker pool keeps a file's highlighted lines under its cache key, which
// falls back to the file's name. One path changed by two commits would then
// share an entry, and the second drawn over the first's lines — a mismatch
// the renderer throws on. Keyed by its contents, each version has its own.
const fileContents = (path: string, contents: string): FileContents => ({
	name: path,
	contents,
	cacheKey: `${path}#${contentHash(contents)}`,
});

// Independently-nullable before/after strings don't structurally match
// DiffFileInput's three-branch union (it forbids "both null"), so this picks
// the one branch that fits rather than letting TypeScript infer a wider type.
export const toDiffFileInput = (file: GuiCommitDiffFile): DiffFileInput => {
	const oldFile = fileContents(file.path, file.before);
	const newFile = fileContents(file.path, file.after);

	// Empty means "did not exist at this revision", same convention the server
	// side already uses (a missing git blob reads as ''). A genuinely empty
	// file on one side, that also exists, is indistinguishable from this and
	// renders as added/deleted rather than an empty-content change.
	if (file.before === '' && file.after !== '') return {oldFile: null, newFile};
	if (file.after === '' && file.before !== '') return {oldFile, newFile: null};

	return {oldFile, newFile};
};
