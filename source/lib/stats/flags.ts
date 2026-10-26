// Things worth a second look on every ticket; prompts, not faults.

import {
	isBuildOrCiPath,
	isDependencyManifest,
	isDocPath,
	isGeneratedPath,
} from './file-kinds.js';
import {filePointer} from './file-pointer.js';
import {ChangeFlags, FilePointer} from './issue-stats.model.js';
import {TicketPatch} from './patch-scan.js';

// A print left in by accident looks exactly like one left in on purpose, so
// this counts rather than judges.
const DEBUG_PRINT =
	/\bconsole\.(log|debug|dir)\s*\(|\bdebugger\b|^\s*print\s*\(|\bfmt\.Print(ln|f)?\s*\(|\bSystem\.out\.print|\bdbg!\s*\(/;

// Six is long enough that two identical runs are unlikely to be coincidence
// and short enough to catch a copy-pasted block before it grows.
const DUPLICATE_BLOCK_LINES = 6;

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
	// Marked, not counted: windows overlap.
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

		// Across files only; repeats within a file are self-churn.
		if (first.file === window[0]?.file) continue;

		for (let offset = 0; offset < DUPLICATE_BLOCK_LINES; offset++) {
			duplicated[first.at + offset] = true;
			duplicated[start + offset] = true;
		}
	}

	return duplicated.filter(Boolean).length;
};

export const deriveFlags = ({patch}: {patch: TicketPatch}): ChangeFlags => {
	const generatedPaths: FilePointer[] = [];
	const dependencyManifests: FilePointer[] = [];
	const buildOrCiPaths: FilePointer[] = [];
	let docsTouched = false;
	let debugPrintLinesAdded = 0;
	let maxIndentLevels = 0;
	// The file the deepest nesting is in, so the number is a place to look
	// rather than a fact with nowhere to go.
	let deepestFile: FilePointer | null = null;

	// One pool across the change, each line tagged with its file, so copies
	// between files are found.
	const normalizedAdded: NormalizedLine[] = [];

	for (const [index, file] of patch.files.entries()) {
		if (isGeneratedPath(file.path)) generatedPaths.push(filePointer(file));
		if (isDependencyManifest(file.path))
			dependencyManifests.push(filePointer(file));
		if (isBuildOrCiPath(file.path)) buildOrCiPaths.push(filePointer(file));
		if (isDocPath(file.path)) docsTouched = true;

		if (file.binary || isGeneratedPath(file.path)) continue;

		const texts = file.added.map(added => added.text);
		const unit = indentUnitOf(texts);

		// Deleted files are left out, or every rename reads as copy-paste
		// (--no-renames).
		const shipping = file.status !== 'deleted';

		for (const text of texts) {
			if (DEBUG_PRINT.test(text)) debugPrintLinesAdded++;

			const levels = indentLevelsOf(text, unit);
			if (levels > maxIndentLevels) {
				maxIndentLevels = levels;
				deepestFile = filePointer(file);
			}

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
		deepestFile,
		duplicatedLines: countDuplicatedLines(normalizedAdded),
	};
};
