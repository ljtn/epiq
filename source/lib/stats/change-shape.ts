// The shape of a ticket's change: how big it is, how it is spread, and how
// much of it the ticket spent rewriting itself.
//
// Nothing here is a verdict. A wide change is not worse than a narrow one —
// it is a different thing to read, and the point of the numbers is to say
// which kind of reading this is before anyone opens the diff.

import {TicketPatch} from './patch-scan.js';

// The commit metadata the shape needs, named here rather than imported from
// the MCP layer that produces it: source/lib/stats takes numbers in and gives
// numbers out, so it stays reachable from the TUI, the GUI server and the MCP
// alike.
export type StatsCommit = {
	sha: string;
	time: number;
	author: string;
	subject: string;
};

export type ChangeShape = {
	commits: number;
	authors: string[];
	firstCommitAt: number | null;
	lastCommitAt: number | null;

	files: number;
	filesAdded: number;
	filesModified: number;
	filesDeleted: number;
	binaryFiles: number;
	// How many distinct directories the change touches. One file in each of
	// fourteen directories and fourteen files in one are the same +/- and
	// nothing like the same review.
	directories: number;

	insertions: number;
	deletions: number;
	net: number;

	// The single busiest file, and its share of every changed line. A ticket
	// at 0.9 is one file's rewrite with some tidying; at 0.1 it is spread
	// evenly and there is no obvious place to start.
	largestFile: {path: string; changed: number} | null;
	concentration: number;

	selfChurn: number;
	truncated: boolean;
};

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
		path: file.path,
		changed: file.added.length + file.removed,
	}));

	const largestFile = changedPerFile.reduce<{
		path: string;
		changed: number;
	} | null>(
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
