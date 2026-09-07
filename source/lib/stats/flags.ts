// The things worth a second look, each cheap enough to be worth checking on
// every ticket.
//
// Every one of these is a prompt, not a fault: a lockfile moved, a dependency
// arrived, something is nested eight deep, the same eight lines appear twice.
// A reviewer with ten minutes should be able to read this list and know where
// to spend them.

import {
	isBuildOrCiPath,
	isDependencyManifest,
	isDocPath,
	isGeneratedPath,
} from './file-kinds.js';
import {TicketPatch} from './patch-scan.js';

// A print left in by accident looks exactly like one left in on purpose, so
// this counts rather than judges.
const DEBUG_PRINT =
	/\bconsole\.(log|debug|dir)\s*\(|\bdebugger\b|^\s*print\s*\(|\bfmt\.Print(ln|f)?\s*\(|\bSystem\.out\.print|\bdbg!\s*\(/;

// Six is long enough that two identical runs are unlikely to be coincidence
// and short enough to catch a copy-pasted block before it grows.
const DUPLICATE_BLOCK_LINES = 6;

export type ChangeFlags = {
	// Paths rather than counts: which lockfile moved is the question a reader
	// actually has. Capped, since the answer stops being useful long before
	// the list stops being long.
	generatedPaths: string[];
	dependencyManifests: string[];
	buildOrCiPaths: string[];
	docsTouched: boolean;

	debugPrintLinesAdded: number;

	// The deepest nesting the change introduced, in levels of the file's own
	// indentation — a tab is one level, and a space-indented file's unit is
	// inferred from its own added lines. An approximation of nesting, and
	// nothing more: it is not cyclomatic complexity and does not stand in for
	// it.
	maxIndentLevels: number;

	// Added lines that sit inside a run of six or more identical lines
	// appearing somewhere else in the change. Counted in lines rather than
	// blocks so the number means one thing: a longer copy is a bigger number.
	// Whitespace-normalised, so a re-indented copy still matches.
	duplicatedLines: number;
};

const PATH_LIST_LIMIT = 10;

const indentUnitOf = (lines: string[]): number => {
	let smallest = 0;

	for (const line of lines) {
		if (line.trim() === '' || line.startsWith('\t')) continue;

		const spaces = line.length - line.trimStart().length;
		if (spaces > 0 && (smallest === 0 || spaces < smallest)) smallest = spaces;
	}

	// Two is the narrowest unit in common use; anything smaller is a
	// continuation line rather than a level, and would double every depth.
	return Math.min(Math.max(smallest, 2), 8);
};

const indentLevelsOf = (line: string, unit: number): number => {
	const indent = line.length - line.trimStart().length;
	if (indent === 0) return 0;

	const tabs = line.slice(0, indent).split('\t').length - 1;

	return tabs > 0 ? tabs : Math.floor(indent / unit);
};

type NormalizedLine = {text: string; file: number};

const countDuplicatedLines = (normalized: NormalizedLine[]): number => {
	if (normalized.length < DUPLICATE_BLOCK_LINES * 2) return 0;

	const firstSeenAt = new Map<string, NormalizedLine & {at: number}>();
	// Marked rather than counted as they are found: windows overlap, so both
	// the copy and the original would otherwise be counted once per window
	// they appear in.
	const duplicated = new Array<boolean>(normalized.length).fill(false);

	for (
		let start = 0;
		start + DUPLICATE_BLOCK_LINES <= normalized.length;
		start++
	) {
		const window = normalized.slice(start, start + DUPLICATE_BLOCK_LINES);

		// A run of blank, near-blank or separator lines matches itself
		// everywhere, and a file boundary is written as one.
		if (window.some(line => line.text.length < 3)) continue;

		const key = window.map(line => line.text).join('\n');
		const first = firstSeenAt.get(key);

		if (first === undefined) {
			firstSeenAt.set(key, {...(window[0] as NormalizedLine), at: start});
			continue;
		}

		// Only across files. The same block landing twice in one path is the
		// ticket re-adding what it wrote earlier — which self-churn already
		// counts, and which would otherwise report every file a ticket split
		// and re-split as a wall of copy-paste.
		if (first.file === window[0]?.file) continue;

		for (let offset = 0; offset < DUPLICATE_BLOCK_LINES; offset++) {
			duplicated[first.at + offset] = true;
			duplicated[start + offset] = true;
		}
	}

	return duplicated.filter(Boolean).length;
};

export const deriveFlags = ({patch}: {patch: TicketPatch}): ChangeFlags => {
	const generatedPaths: string[] = [];
	const dependencyManifests: string[] = [];
	const buildOrCiPaths: string[] = [];
	let docsTouched = false;
	let debugPrintLinesAdded = 0;
	let maxIndentLevels = 0;

	// One pool across the whole change: the copy-paste worth catching is the
	// one from one file into another, which a per-file pass would miss. Each
	// line remembers which file it came from, so a repeat *inside* one file
	// can be told apart from a copy between two.
	const normalizedAdded: NormalizedLine[] = [];

	for (const [index, file] of patch.files.entries()) {
		if (isGeneratedPath(file.path)) generatedPaths.push(file.path);
		if (isDependencyManifest(file.path)) dependencyManifests.push(file.path);
		if (isBuildOrCiPath(file.path)) buildOrCiPaths.push(file.path);
		if (isDocPath(file.path)) docsTouched = true;

		if (file.binary || isGeneratedPath(file.path)) continue;

		const texts = file.added.map(added => added.text);
		const unit = indentUnitOf(texts);

		// A file the ticket ended by deleting is not code it is shipping, and
		// leaving it in the pool turns every rename and every file split into
		// a wall of copy-paste: with --no-renames the old path's lines and the
		// new path's are two additions of the same block.
		const shipping = file.status !== 'deleted';

		for (const text of texts) {
			if (DEBUG_PRINT.test(text)) debugPrintLinesAdded++;

			maxIndentLevels = Math.max(maxIndentLevels, indentLevelsOf(text, unit));
			if (shipping) normalizedAdded.push({text: text.trim(), file: index});
		}

		// A separator, so a window never spans two files and reports the join
		// between them as a repeat.
		normalizedAdded.push({text: ' ', file: index});
	}

	return {
		generatedPaths: generatedPaths.slice(0, PATH_LIST_LIMIT),
		dependencyManifests: dependencyManifests.slice(0, PATH_LIST_LIMIT),
		buildOrCiPaths: buildOrCiPaths.slice(0, PATH_LIST_LIMIT),
		docsTouched,
		debugPrintLinesAdded,
		maxIndentLevels,
		duplicatedLines: countDuplicatedLines(normalizedAdded),
	};
};
