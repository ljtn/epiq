// A file, addressed the way the Commits tab addresses one.
//
// Every path a stat names is somewhere a reader may want to go, and the
// Commits tab opens a file by commit and path. The last of the ticket's
// commits to touch a file is the one to open: it is the file as the ticket
// left it, not as it was halfway through.

import {FilePointer} from './issue-stats.model.js';
import {FileChange} from './patch-scan.js';

export const filePointer = (file: FileChange): FilePointer => ({
	path: file.path,
	// `shas` is in the order the scan walked them, oldest first.
	sha: file.shas[file.shas.length - 1] ?? '',
});
