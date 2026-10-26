// Everything a ticket's Stats tab is told. Types only, no imports, all
// JSON-serializable: the GUI client reads it too.

export type StatsCommit = {
	sha: string;
	/** The registered repo it is in; absent for the board's own. */
	repo?: string;
	time: number;
	author: string;
	subject: string;
};

/** A file and the last ticket commit to touch it, as the Commits tab links it. */
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
	// Distinct directories the change touches.
	directories: number;

	insertions: number;
	deletions: number;
	net: number;

	// The busiest file and its share of every changed line.
	largestFile: (FilePointer & {changed: number}) | null;
	concentration: number;

	// Lines the ticket added and then removed in a later commit of its own.
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
	// Lines, not a test-to-code ratio, which reflects the language more than
	// testing.
	testLinesAdded: number;
	testLinesRemoved: number;

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
	// The repo's share just before this ticket; null means no comparison, not zero.
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

	// Nesting in indentation levels; an approximation, not cyclomatic complexity.
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
