// Everything a ticket's Stats tab is told, in one place.
//
// Types only, and no imports at all, so the GUI client can read this file the
// same way the Node side does without dragging anything runnable across the
// boundary that separates them. Nothing here holds a Map or a Set: every field
// travels over a websocket as JSON.

export type StatsCommit = {
	sha: string;
	time: number;
	author: string;
	subject: string;
};

/**
 * A file, and the last of the ticket's commits to touch it.
 *
 * The sha is what makes a stat a place rather than a number: a reader who sees
 * "22% of the change is in one file" wants that file's diff, and the pair is
 * exactly what the Commits tab's deep link takes.
 */
export type FilePointer = {
	path: string;
	sha: string;
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
	largestFile: (FilePointer & {changed: number}) | null;
	concentration: number;

	// Lines the ticket added and then removed again in a later commit of its
	// own — thrash it did to itself, as against churn against what was already
	// there.
	selfChurn: number;
	// A cap cut the scan short, so every count below is a floor.
	truncated: boolean;
};

export type LanguageLines = {
	name: string;
	added: number;
	removed: number;
	// Of `added`, how much landed in test files.
	addedInTests: number;
	// This language's share of every changed line in the ticket.
	share: number;
};

export type LanguageBreakdown = {
	languages: LanguageLines[];
	// Languages in this change that no file in the repository had before it.
	// Empty when there was no earlier revision to compare against.
	introduced: string[];
	generatedLines: number;
};

export type TestSignal = {
	testLinesAdded: number;
	testLinesRemoved: number;
	codeLinesAdded: number;
	// Null when the ticket added no code lines at all: dividing by nothing
	// would print Infinity for a tests-only ticket, which is exactly the case
	// somebody would misread as the best score on the board.
	ratio: number | null;
	touchedTests: boolean;

	// The test files this ticket added, so the count links to the tests
	// themselves rather than only asserting they exist.
	addedTestFiles: FilePointer[];
	deletedTestFiles: FilePointer[];

	skippedTestLinesAdded: number;
	focusedTestLinesAdded: number;
};

export type LanguageCommentShare = {
	name: string;
	commentLines: number;
	codeLines: number;
	// Comments as a share of the lines that are not blank.
	share: number;
	// The same share across the repository just before this ticket, or null
	// when there was no baseline to read. Null renders as "no comparison",
	// never as zero.
	repoShare: number | null;
};

export type CommentDensity = {
	byLanguage: LanguageCommentShare[];
	commentLines: number;
	codeLines: number;
	blankLines: number;
	share: number;
	todoLinesAdded: number;
	todoLinesRemoved: number;
	commentedOutCodeLines: number;
};

export type ChangeFlags = {
	generatedPaths: FilePointer[];
	dependencyManifests: FilePointer[];
	buildOrCiPaths: FilePointer[];
	docsTouched: boolean;

	debugPrintLinesAdded: number;

	// Nesting in levels of the file's own indentation. An approximation, and
	// nothing more: it is not cyclomatic complexity and does not stand in for
	// it.
	maxIndentLevels: number;
	// Where that deepest nesting is, so the number is a place to look.
	deepestFile: FilePointer | null;

	// Added lines inside a run of six or more identical lines appearing
	// somewhere else in the change.
	duplicatedLines: number;
};

export type IssueStats = {
	ref: string;
	shape: ChangeShape;
	languages: LanguageBreakdown;
	tests: TestSignal;
	comments: CommentDensity;
	flags: ChangeFlags;
};
