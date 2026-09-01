// What the orchestrator hands an actor process, and what it gets back.

export type ActorAction =
	| {kind: 'create'; title: string}
	| {kind: 'comment'; issueId: string; body: string}
	| {kind: 'tag'; issueId: string; tagName: string}
	| {kind: 'close'; issueId: string};

export type ActorJob = {
	repoRoot: string;
	userId: string;
	userName: string;
	actions: ActorAction[];
	// Creates the project: state branch, worktree and the default events.
	init?: boolean;
	sync: boolean;
	reportPath: string;
	// Holds the process still before it starts, so two of them can be aimed at
	// the same moment rather than merely started together.
	startDelayMs?: number;
	// Spreads the actions out, so a writer stays writing for as long as the
	// sync it is racing takes.
	pauseMs?: number;
};

export type ActorReport = {
	userId: string;
	// Refusals rather than crashes. An action the board declined is a result the
	// run wants to see, not a reason to stop.
	problems: string[];
	// Ids this actor wrote to its own log, which is what it is accountable for.
	authoredEventIds: string[];
	// Every id in this actor's state worktree, its own and everyone else's.
	seenEventIds: string[];
	// The same events in the order the loader derives — parent edge first,
	// concurrent siblings by ulid. Two actors holding the same events must
	// derive the same order, or they materialize different boards.
	orderedEventIds: string[];
	// `id\ttitle` per issue, sorted, for comparing boards between actors.
	issues: string[];
};
