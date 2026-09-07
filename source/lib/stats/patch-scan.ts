// One `git show` over every commit a ticket owns, parsed into the lines it
// added and removed.
//
// Everything else under source/lib/stats reads this scan rather than shelling
// out again: the text of the added lines answers the language, comment and
// flag questions, and their counts answer the shape of the change. `git show`
// takes every sha in one invocation, so a ticket costs one spawn however many
// commits it has — patches are also far smaller than the whole-blob reads the
// GUI's diff panel needs, since a patch carries only what changed.

import {execGit} from '../../git/git-utils.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';

export type PatchLine = {
	// The commit that added the line, and the line's number in *that commit's*
	// version of the file. Any later commit moves it, so the pair anchors into
	// history rather than pointing at the file as it stands now — which is why
	// coverage anchors with blame instead of reusing these numbers.
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
	added: PatchLine[];
	// The count rather than `removedLines.length`: retention is capped and the
	// count is not, so on a huge ticket the two part company and the count is
	// the one that stays true.
	removed: number;
	removedLines: PatchLine[];
	// The ticket's commits that touched this file, oldest first.
	shas: string[];
};

export type TicketPatch = {
	files: FileChange[];
	insertions: number;
	deletions: number;
	// Lines the ticket added and then removed again in a later commit of its
	// own — thrash it did to itself, as against churn against what was already
	// there. Matched on line text within a file, so a line moved between two
	// files does not count and a genuine re-edit of the same line does.
	selfChurn: number;
	scannedCommits: number;
	// Set when a cap cut the scan short, so a reader knows the numbers are a
	// floor rather than the whole ticket.
	truncated: boolean;
};

// Sized to be unreachable by a ticket somebody meant to file and cheap to hit
// by one that swept a vendored tree in. A capped scan still answers with the
// newest commits, which is the part anyone is looking at.
export const MAX_SCANNED_COMMITS = 200;

// Text retention is the memory cost here — the counts are just numbers. Past
// this the scan keeps counting and stops keeping.
export const MAX_RETAINED_ADDED_LINES = 200_000;

// Non-printable, so it cannot occur inside a sha or a patch line.
const RECORD_SEP = '\x1e';

// `@@ -<old> +<new>[,<count>] @@` — with --unified=0 there is no context, so
// the first added line of a hunk is exactly the number this carries.
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// The backreference is what makes this safe for a path containing spaces:
// --no-renames means both sides are always the same path, so the split point
// is the one where they match.
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
 * Walks the combined `git show` output of several commits, oldest first, and
 * folds it into one entry per path.
 *
 * Exported for its own tests: the parsing is where the sharp edges are (binary
 * files carry no ---/+++ pair, a deletion has no after-side, a hunk header is
 * the only place a line number appears at all), and they are all reachable
 * from a fixture without a repository.
 */
export const parsePatchOutput = (
	stdout: string,
): Omit<TicketPatch, 'truncated' | 'scannedCommits'> & {
	retainedLines: number;
} => {
	const byPath = new Map<string, OpenFile>();

	let sha = '';
	let open: OpenFile | null = null;
	let pendingPath: string | null = null;
	let oldPath: string | null = null;
	let nextLine = 0;
	let selfChurn = 0;
	let insertions = 0;
	let deletions = 0;
	let retainedLines = 0;

	const openPath = (path: string, status: FileChangeStatus): OpenFile => {
		const existing = byPath.get(path);

		if (existing) {
			existing.entry.status = status;
			if (!existing.entry.shas.includes(sha)) existing.entry.shas.push(sha);
			return existing;
		}

		const entry: FileChange = {
			path,
			status,
			binary: false,
			added: [],
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
			continue;
		}

		if (line.startsWith('diff --git ')) {
			open = null;
			oldPath = null;
			pendingPath = DIFF_GIT.exec(line)?.[1] ?? null;
			continue;
		}

		// Only ever seen for a binary file: a text diff opens with ---/+++ and
		// takes the branch below before this one can matter.
		if (line.startsWith('Binary files ') && pendingPath) {
			open = openPath(pendingPath, 'modified');
			open.entry.binary = true;
			continue;
		}

		if (line.startsWith('--- ')) {
			oldPath = stripPrefix(line.slice(4), 'a/');
			continue;
		}

		if (line.startsWith('+++ ')) {
			const newPath = stripPrefix(line.slice(4), 'b/');
			const path = newPath ?? oldPath ?? pendingPath;
			if (path) open = openPath(path, statusFor(oldPath, newPath));
			continue;
		}

		const hunk = HUNK.exec(line);
		if (hunk) {
			nextLine = Number(hunk[1]);
			continue;
		}

		if (!open) continue;

		if (line.startsWith('+')) {
			const text = line.slice(1);
			insertions++;

			if (retainedLines < MAX_RETAINED_ADDED_LINES) {
				open.entry.added.push({sha, line: nextLine, text});
				retainedLines++;
			}

			open.pendingByText.set(text, (open.pendingByText.get(text) ?? 0) + 1);
			nextLine++;
			continue;
		}

		if (line.startsWith('-')) {
			const text = line.slice(1);
			deletions++;
			open.entry.removed++;

			if (retainedLines < MAX_RETAINED_ADDED_LINES) {
				// A removed line has no line number worth carrying — it is gone
				// from the after-side, and the before-side numbering it belonged to
				// is not what any later read is anchored on. The sha and the text
				// are what the stats above it ask for.
				open.entry.removedLines.push({sha, line: 0, text});
				retainedLines++;
			}

			const pending = open.pendingByText.get(text) ?? 0;
			// Blank and near-blank lines match each other everywhere and would
			// turn any reformatting into "thrash"; a closing brace is the same
			// line in every function.
			if (pending > 0 && text.trim().length > 2) {
				selfChurn++;
				open.pendingByText.set(text, pending - 1);
			}
		}
	}

	return {
		files: [...byPath.values()].map(file => file.entry),
		insertions,
		deletions,
		selfChurn,
		retainedLines,
	};
};

/**
 * `shas` in any order; they are scanned oldest first regardless, since
 * self-churn only means anything read forwards. The caller's order is not
 * assumed to be chronological — `getCommitsForRef` answers newest first.
 */
export const scanTicketPatch = async ({
	repoRoot,
	shas,
}: {
	repoRoot: string;
	shas: string[];
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

	// The newest are kept when the cap bites: a truncated answer should be
	// about the part of the ticket somebody is currently reading.
	const scanned = shas.slice(0, MAX_SCANNED_COMMITS);

	const showResult = await execGit({
		cwd: repoRoot,
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
			// Oldest first: self-churn is "added earlier, removed later".
			...[...scanned].reverse(),
		],
	});

	if (isFail(showResult)) return failed(showResult.message);

	const parsed = parsePatchOutput(showResult.value.stdout);

	return succeeded('Scanned ticket patch', {
		files: parsed.files,
		insertions: parsed.insertions,
		deletions: parsed.deletions,
		selfChurn: parsed.selfChurn,
		scannedCommits: scanned.length,
		truncated:
			scanned.length < shas.length ||
			parsed.retainedLines >= MAX_RETAINED_ADDED_LINES,
	});
};
