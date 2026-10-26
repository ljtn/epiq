// A file, as the Commits tab opens it: by the last ticket commit to touch it.

import {FilePointer} from './issue-stats.model.js';
import {FileChange} from './patch-scan.js';

export const filePointer = (file: FileChange): FilePointer => ({
	path: file.path,
	// `shas` is in the order the scan walked them, oldest first.
	sha: file.shas[file.shas.length - 1] ?? '',
});
