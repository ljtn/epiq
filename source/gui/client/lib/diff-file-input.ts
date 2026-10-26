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

// The worker pool caches by this key; keyed by contents and side, so two
// versions of one path never share highlighted lines.
const fileContents = (
	side: 'old' | 'new',
	path: string,
	contents: string,
): FileContents => ({
	name: path,
	contents,
	cacheKey: `${side}:${path}#${contentHash(contents)}`,
});

// Picks the one branch of DiffFileInput's union that fits.
export const toDiffFileInput = (file: GuiCommitDiffFile): DiffFileInput => {
	const oldFile = fileContents('old', file.path, file.before);
	const newFile = fileContents('new', file.path, file.after);

	// Empty means "did not exist at this revision", as on the server. A truly
	// empty file therefore renders as added or deleted.
	if (file.before === '' && file.after !== '') return {oldFile: null, newFile};
	if (file.after === '' && file.before !== '') return {oldFile, newFile: null};

	return {oldFile, newFile};
};
