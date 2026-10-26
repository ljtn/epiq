// One `git show` over a ticket's commits, parsed into added and removed lines.
// Every stat here reads this scan rather than calling git again.

import {execGit} from '../../git/git-utils.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';

export type PatchLine = {
	// The commit that added the line and its number in that commit's file.
	sha: string;
	line: number;
	text: string;
};

export type FileChangeStatus = 'added' | 'modified' | 'deleted';

export type FileChange = {
	path: string;
	// The last status the ticket left the file in: a file it added and later
	// deleted reads as deleted, which is what it is by the end of the ticket.
	status: FileChangeStatus;
	// No line counts to give. Excluded from every line-based stat rather than
	// counted as zero.
	binary: boolean;
	// Line content, capped at MAX_RETAINED_ADDED_LINES; text stats are partial
	// past it.
	added: PatchLine[];
	removedLines: PatchLine[];
	// Uncapped counts, so totals always match the real +/-.
	addedCount: number;
	removed: number;
	// The ticket's commits that touched this file, oldest first.
	shas: string[];
};

export type TicketPatch = {
	files: FileChange[];
	insertions: number;
	deletions: number;
	// Lines added then removed by a later commit of the ticket, matched on text
	// within a file.
	selfChurn: number;
	scannedCommits: number;
	// Set when a cap cut the scan short, so a reader knows the numbers are a
	// floor rather than the whole ticket.
	truncated: boolean;
};

// Out of reach for a real ticket; a capped scan keeps the newest commits.
export const MAX_SCANNED_COMMITS = 200;

// Text retention is the memory cost here — the counts are just numbers. Past
// this the scan keeps counting and stops keeping.
export const MAX_RETAINED_ADDED_LINES = 200_000;

// Bounds self-churn's per-file text set.
const MAX_SELF_CHURN_KEYS_PER_FILE = 50_000;

// Shas are shown a batch at a time: one huge output string can pass V8's
// limit and throw outside any try/catch.
const SHAS_PER_SHOW = 25;

// A budget across batches, so a pathological ticket stops the scan, not the
// process.
const MAX_PATCH_BYTES = 64 * 1024 * 1024;

// Non-printable, so it cannot occur inside a sha or a patch line.
const RECORD_SEP = '\x1e';

// `@@ -<old> +<new>[,<count>] @@` — with --unified=0 there is no context, so
// the first added line of a hunk is exactly the number this carries.
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// The backreference handles spaces: with --no-renames both paths match.
const DIFF_GIT = /^diff --git a\/(.+) b\/\1$/;

const stripPrefix = (raw: string, prefix: string): string | null =>
	raw === '/dev/null' ? null : raw.startsWith(prefix) ? raw.slice(2) : raw;

type OpenFile = {
	entry: FileChange;
	// Added-line texts still unmatched, oldest first per text, so a later
	// removal of the same text pairs with the earliest addition of it.
	pendingByText: Map<string, number>;
};

const statusFor = (
	oldPath: string | null,
	newPath: string | null,
): FileChangeStatus =>
	oldPath === null ? 'added' : newPath === null ? 'deleted' : 'modified';

/**
 * Folds the combined `git show` output of several commits, oldest first,
 * into one entry per path.
 */
export type ScanState = {
	byPath: Map<string, OpenFile>;
	insertions: number;
	deletions: number;
	selfChurn: number;
	retainedLines: number;
};

export const createScanState = (): ScanState => ({
	byPath: new Map(),
	insertions: 0,
	deletions: 0,
	selfChurn: 0,
	retainedLines: 0,
});

// Folds one batch into the running scan, so self-churn spans batches.
export const parsePatchInto = (state: ScanState, stdout: string): void => {
	const byPath = state.byPath;

	let sha = '';
	let open: OpenFile | null = null;
	let pendingPath: string | null = null;
	let oldPath: string | null = null;
	// Between `diff --git` and the first hunk, where `---`/`+++` are headers.
	let inHeader = false;
	let nextLine = 0;

	// `added` survives a later modify; a delete wins, and a re-add is `added`
	// again.
	const foldStatus = (
		before: FileChangeStatus,
		next: FileChangeStatus,
	): FileChangeStatus =>
		next === 'modified' && before === 'added' ? 'added' : next;

	const openPath = (path: string, status: FileChangeStatus): OpenFile => {
		const existing = byPath.get(path);

		if (existing) {
			existing.entry.status = foldStatus(existing.entry.status, status);
			if (!existing.entry.shas.includes(sha)) existing.entry.shas.push(sha);
			return existing;
		}

		const entry: FileChange = {
			path,
			status,
			binary: false,
			added: [],
			addedCount: 0,
			removed: 0,
			removedLines: [],
			shas: [sha],
		};

		const created: OpenFile = {entry, pendingByText: new Map()};
		byPath.set(path, created);

		return created;
	};

	for (const line of stdout.split('\n')) {
		if (line.startsWith(RECORD_SEP)) {
			sha = line.slice(RECORD_SEP.length).trim();
			open = null;
			pendingPath = null;
			oldPath = null;
			inHeader = false;
			continue;
		}

		if (line.startsWith('diff --git ')) {
			open = null;
			oldPath = null;
			inHeader = true;
			pendingPath = DIFF_GIT.exec(line)?.[1] ?? null;
			continue;
		}

		// Only binary files reach here; /dev/null marks add or delete.
		if (inHeader && line.startsWith('Binary files ') && pendingPath) {
			const [, sides = ''] = /^Binary files (.*) differ$/.exec(line) ?? [];
			const [beforeSide = '', afterSide = ''] = sides.split(' and ');

			open = openPath(
				pendingPath,
				statusFor(
					beforeSide === '/dev/null' ? null : beforeSide,
					afterSide === '/dev/null' ? null : afterSide,
				),
			);
			open.entry.binary = true;
			continue;
		}

		// Only in the header, or a content line like `-- x` reads as a file header.
		if (inHeader && line.startsWith('--- ')) {
			oldPath = stripPrefix(line.slice(4), 'a/');
			continue;
		}

		if (inHeader && line.startsWith('+++ ')) {
			const newPath = stripPrefix(line.slice(4), 'b/');
			const path = newPath ?? oldPath ?? pendingPath;
			if (path) open = openPath(path, statusFor(oldPath, newPath));
			continue;
		}

		const hunk = HUNK.exec(line);
		if (hunk) {
			nextLine = Number(hunk[1]);
			inHeader = false;
			continue;
		}

		if (!open) continue;

		if (line.startsWith('+')) {
			const text = line.slice(1);
			state.insertions++;
			open.entry.addedCount++;

			if (state.retainedLines < MAX_RETAINED_ADDED_LINES) {
				open.entry.added.push({sha, line: nextLine, text});
				state.retainedLines++;
			}

			// Bounded for the same reason the line arrays are: one entry per
			// distinct added line text, and a vendored tree has millions.
			if (open.pendingByText.size < MAX_SELF_CHURN_KEYS_PER_FILE) {
				open.pendingByText.set(text, (open.pendingByText.get(text) ?? 0) + 1);
			}

			nextLine++;
			continue;
		}

		if (line.startsWith('-')) {
			const text = line.slice(1);
			state.deletions++;
			open.entry.removed++;

			if (state.retainedLines < MAX_RETAINED_ADDED_LINES) {
				// A removed line keeps no line number; only its sha and text matter.
				open.entry.removedLines.push({sha, line: 0, text});
				state.retainedLines++;
			}

			const pending = open.pendingByText.get(text) ?? 0;
			// Blank lines and lone braces match everywhere, so they aren't churn.
			if (pending > 0 && text.trim().length > 2) {
				state.selfChurn++;
				open.pendingByText.set(text, pending - 1);
			}
		}
	}
};

const scanResult = (
	state: ScanState,
): Omit<TicketPatch, 'truncated' | 'scannedCommits'> & {
	retainedLines: number;
} => ({
	files: [...state.byPath.values()].map(file => file.entry),
	insertions: state.insertions,
	deletions: state.deletions,
	selfChurn: state.selfChurn,
	retainedLines: state.retainedLines,
});

/** One batch, start to finish — the shape the parser's own tests drive. */
export const parsePatchOutput = (stdout: string) => {
	const state = createScanState();
	parsePatchInto(state, stdout);

	return scanResult(state);
};

/** `shas` in any order; scanned oldest first, as self-churn needs. */
export const scanTicketPatch = async ({
	repoRoot,
	shas,
	cwdOf = () => repoRoot,
}: {
	repoRoot: string;
	shas: string[];
	/** Where a sha's patch is read, for a ticket whose commits span repos. */
	cwdOf?: (sha: string) => string;
}): Promise<Result<TicketPatch>> => {
	if (shas.length === 0) {
		return succeeded('No commits to scan', {
			files: [],
			insertions: 0,
			deletions: 0,
			selfChurn: 0,
			scannedCommits: 0,
			truncated: false,
		});
	}

	// Keeps the newest under the cap, then reverses to scan oldest first.
	const scanned = shas.slice(0, MAX_SCANNED_COMMITS).reverse();

	const state = createScanState();

	let bytes = 0;
	let scannedCommits = 0;
	let overBudget = false;

	// Batches never straddle repos: one `git show` reads one repository.
	const batches: {cwd: string; shas: string[]}[] = [];
	for (const sha of scanned) {
		const cwd = cwdOf(sha);
		const last = batches[batches.length - 1];

		if (last && last.cwd === cwd && last.shas.length < SHAS_PER_SHOW) {
			last.shas.push(sha);
		} else {
			batches.push({cwd, shas: [sha]});
		}
	}

	for (const {cwd, shas: batch} of batches) {
		const showResult = await execGit({
			cwd,
			// The budget left, checked by git's own reader: a check after the
			// batch arrives has already held all of it.
			maxOutput: Math.max(1, MAX_PATCH_BYTES - bytes),
			keepPartial: true,
			args: [
				// Otherwise a non-ASCII path arrives octal-escaped and quoted, and
				// stops matching the paths every other git call here reports.
				'-c',
				'core.quotePath=false',
				'show',
				'--unified=0',
				'--no-renames',
				'--no-color',
				`--format=${RECORD_SEP}%H`,
				...batch,
			],
		});

		if (isFail(showResult)) {
			// Another repo's clone failing costs its own commits, never the
			// ticket's stats: the timeline reads around a broken clone too.
			if (cwd !== repoRoot) continue;

			return failed(showResult.message);
		}

		// Past the budget, the lines that arrived are counted and the rest left.
		parsePatchInto(state, showResult.value.stdout);
		bytes += showResult.value.stdout.length;
		scannedCommits += batch.length;

		if (showResult.value.truncated || bytes > MAX_PATCH_BYTES) {
			overBudget = true;
			break;
		}
	}

	const parsed = scanResult(state);

	return succeeded('Scanned ticket patch', {
		files: parsed.files,
		insertions: parsed.insertions,
		deletions: parsed.deletions,
		selfChurn: parsed.selfChurn,
		scannedCommits,
		truncated:
			overBudget ||
			scannedCommits < shas.length ||
			parsed.retainedLines >= MAX_RETAINED_ADDED_LINES,
	});
};
