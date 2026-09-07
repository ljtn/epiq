// The shape of a ticket's change: how big it is, how it is spread, and how
// much of it the ticket spent rewriting itself.
//
// Nothing here is a verdict. A wide change is not worse than a narrow one —
// it is a different thing to read, and the point of the numbers is to say
// which kind of reading this is before anyone opens the diff.

import {filePointer} from './file-pointer.js';
import {ChangeShape, FilePointer, StatsCommit} from './issue-stats.model.js';
import {TicketPatch} from './patch-scan.js';

const directoryOf = (path: string): string => {
	const cut = path.lastIndexOf('/');

	return cut === -1 ? '.' : path.slice(0, cut);
};

export const deriveChangeShape = ({
	commits,
	patch,
}: {
	commits: StatsCommit[];
	patch: TicketPatch;
}): ChangeShape => {
	const times = commits.map(commit => commit.time);

	const changedPerFile = patch.files.map(file => ({
		...filePointer(file),
		changed: file.addedCount + file.removed,
	}));

	const largestFile = changedPerFile.reduce<
		(FilePointer & {changed: number}) | null
	>(
		(largest, file) =>
			largest === null || file.changed > largest.changed ? file : largest,
		null,
	);

	const totalChanged = patch.insertions + patch.deletions;

	return {
		commits: commits.length,
		// Sorted so the list reads the same twice, and deduplicated: an author
		// is a person here, not a commit.
		authors: [...new Set(commits.map(commit => commit.author))].sort(),
		firstCommitAt: times.length ? Math.min(...times) : null,
		lastCommitAt: times.length ? Math.max(...times) : null,

		files: patch.files.length,
		filesAdded: patch.files.filter(file => file.status === 'added').length,
		filesModified: patch.files.filter(file => file.status === 'modified')
			.length,
		filesDeleted: patch.files.filter(file => file.status === 'deleted').length,
		binaryFiles: patch.files.filter(file => file.binary).length,
		directories: new Set(patch.files.map(file => directoryOf(file.path))).size,

		insertions: patch.insertions,
		deletions: patch.deletions,
		net: patch.insertions - patch.deletions,

		largestFile,
		concentration:
			largestFile && totalChanged > 0 ? largestFile.changed / totalChanged : 0,

		selfChurn: patch.selfChurn,
		truncated: patch.truncated,
	};
};
