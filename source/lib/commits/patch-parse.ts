// What a unified patch says, as rows a terminal can draw.
//
// The patch is git's own, not one derived here from the two revisions of each
// file: git already knows about renames, binary blobs, mode changes and the
// missing trailing newline, and re-deriving hunks from `before`/`after` would
// mean disagreeing with it at exactly those edges. The `@@` headers also carry
// real line numbers, which is what a comment anchored to a line needs.

export type PatchLineKind = 'context' | 'added' | 'removed' | 'hunk' | 'note';

export type PatchLine = {
	kind: PatchLineKind;
	text: string;
	// The line's number in the old and the new revision. A removed line has no
	// number in the new one, an added line none in the old, and a hunk header
	// or a note belongs to neither.
	oldLine?: number;
	newLine?: number;
};

export type PatchFile = {
	/** The new path, or the old one where the file was deleted. */
	path: string;
	/** Set only where the file moved, so a caller can say "x -> y". */
	oldPath: string | null;
	binary: boolean;
	added: number;
	removed: number;
	lines: PatchLine[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

// `git show` renders a path it considers unusual as a C quoted string. Undoing
// that is what keeps a file with a space or a non-ASCII name readable.
const unquotePath = (raw: string): string => {
	if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;

	const body = raw.slice(1, -1);
	let out = '';

	for (let index = 0; index < body.length; index++) {
		if (body[index] !== '\\') {
			out += body[index];
			continue;
		}

		const next = body[++index];

		if (next === 'n') out += '\n';
		else if (next === 't') out += '\t';
		else if (next === '"' || next === '\\') out += next;
		else if (next && /[0-7]/.test(next)) {
			// An octal escape is one byte of UTF-8; decoding runs of them together
			// is what turns three escapes back into one character.
			const octal = body.slice(index, index + 3);
			out += String.fromCharCode(parseInt(octal, 8));
			index += 2;
		} else if (next !== undefined) out += next;
	}

	// Each octal escape produced one byte; reading them back as UTF-8 is what
	// makes a multi-byte character whole again.
	try {
		return decodeURIComponent(escape(out));
	} catch {
		return out;
	}
};

// Everything after the `--- ` / `+++ ` marker is the path, so a name with
// spaces survives — which splitting the `diff --git a/x b/y` line would not.
const stripPrefix = (raw: string): string | null => {
	const path = unquotePath(raw.trim());
	if (path === '/dev/null') return null;

	return path.replace(/^[ab]\//, '');
};

export const parsePatch = (patch: string): PatchFile[] => {
	const files: PatchFile[] = [];

	let file: PatchFile | null = null;
	let oldLine = 0;
	let newLine = 0;

	const begin = (): PatchFile => {
		const started: PatchFile = {
			path: '',
			oldPath: null,
			binary: false,
			added: 0,
			removed: 0,
			lines: [],
		};
		files.push(started);
		return started;
	};

	for (const row of patch.split('\n')) {
		if (row.startsWith('diff --git ')) {
			file = begin();
			// A fallback name, for the files that never get a `+++` line: a binary
			// blob, or a change of mode alone. Ambiguous where a path contains
			// " b/", which is why it is only a fallback — `+++` overwrites it.
			const pair = row.slice('diff --git '.length);
			const split = pair.lastIndexOf(' b/');
			if (split !== -1) {
				file.path = unquotePath(pair.slice(split + 1)).replace(/^b\//, '');
			}
			continue;
		}

		// A patch that starts straight at a hunk (a caller handing us one file's
		// worth) still has somewhere to put its rows.
		if (!file) {
			if (!row.trim()) continue;
			file = begin();
		}

		const current: PatchFile = file;

		if (row.startsWith('--- ')) {
			const path = stripPrefix(row.slice(4));
			if (path) current.oldPath = path;
			continue;
		}

		if (row.startsWith('+++ ')) {
			const path = stripPrefix(row.slice(4));
			if (path) current.path = path;
			continue;
		}

		if (row.startsWith('rename from ')) {
			current.oldPath = unquotePath(row.slice('rename from '.length));
			continue;
		}

		if (row.startsWith('rename to ')) {
			current.path = unquotePath(row.slice('rename to '.length));
			continue;
		}

		if (row.startsWith('Binary files ') || row.startsWith('GIT binary patch')) {
			current.binary = true;
			current.lines.push({kind: 'note', text: 'Binary file'});
			continue;
		}

		const hunk = HUNK_HEADER.exec(row);
		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[3]);
			current.lines.push({kind: 'hunk', text: row});
			continue;
		}

		// Before the first hunk everything is header noise (index, mode,
		// similarity) that the rows below already say more plainly.
		if (current.lines.length === 0) continue;

		if (row.startsWith('\\')) {
			current.lines.push({kind: 'note', text: row.slice(1).trim()});
			continue;
		}

		if (row.startsWith('+')) {
			current.added++;
			current.lines.push({
				kind: 'added',
				text: row.slice(1),
				newLine: newLine++,
			});
			continue;
		}

		if (row.startsWith('-')) {
			current.removed++;
			current.lines.push({
				kind: 'removed',
				text: row.slice(1),
				oldLine: oldLine++,
			});
			continue;
		}

		if (row.startsWith(' ')) {
			current.lines.push({
				kind: 'context',
				text: row.slice(1),
				oldLine: oldLine++,
				newLine: newLine++,
			});
			continue;
		}

		// A bare empty row inside a hunk is a context line whose single leading
		// space git left off the end of the patch.
		if (row === '') {
			current.lines.push({
				kind: 'context',
				text: '',
				oldLine: oldLine++,
				newLine: newLine++,
			});
		}
	}

	// A file whose `+++` never arrived (a pure mode change) still has a name.
	for (const entry of files) {
		if (!entry.path && entry.oldPath) entry.path = entry.oldPath;
	}

	return files.filter(entry => entry.path !== '');
};

// The rename a caller should show, or null where the file stayed put.
export const renamedFrom = (file: PatchFile): string | null =>
	file.oldPath && file.oldPath !== file.path ? file.oldPath : null;

export const patchLineCount = (files: PatchFile[]): number =>
	files.reduce((total, file) => total + file.lines.length, 0);

export type PatchRow =
	| PatchLine
	| {kind: 'file'; text: string; file: PatchFile};

export const isFileRow = (
	row: PatchRow,
): row is {kind: 'file'; text: string; file: PatchFile} => row.kind === 'file';

/**
 * Every file's rows as one flat list, each headed by its path.
 *
 * One list rather than a list per file, because a reader scrolls a commit
 * rather than picking a file out of it — and the terminal has one cursor, so
 * one list is also what the navigation can address.
 */
export const patchRows = (files: PatchFile[]): PatchRow[] =>
	files.flatMap(file => [
		{
			kind: 'file' as const,
			text: `${renamedFrom(file) ? `${renamedFrom(file)} → ` : ''}${file.path}`,
			file,
		},
		...file.lines,
	]);

export type RowSelection = {
	filePath: string;
	/** Line numbers in the new revision, which is the only side we anchor to. */
	start: number;
	end: number;
	snippet: string;
};

// Which file and which hunk each row belongs to, so a range can be refused
// when it spans either.
const rowScopes = (rows: PatchRow[]): {file: string; hunk: number}[] => {
	let file = '';
	let hunk = -1;

	return rows.map(row => {
		if (row.kind === 'file') file = (row as {file: PatchFile}).file.path;
		if (row.kind === 'hunk') hunk++;

		return {file, hunk};
	});
};

/**
 * The selection two rows of a patch describe, or why they describe none.
 *
 * Anchored to the new revision only. A new-side line number means the same
 * thing in every view of that revision; an old-side one is a position in
 * whichever revision this particular diff happened to be against, so a comment
 * carrying one renders in the view that made it and nowhere else.
 *
 * Held to a single hunk, which is what keeps the snippet identical to the one
 * the GUI cuts straight out of the file: across a hunk boundary the patch is
 * missing the unchanged lines in between, so the same range would quote fewer
 * lines here than there.
 */
/**
 * The lines a selection covers, written the way the command line shows them.
 *
 * The range travels in the typed command rather than in state the reader
 * cannot see, so `:comment lines:4-9 ...` says what it will attach to and can
 * be corrected before it is sent.
 */
export const formatLineAnchor = (start: number, end: number): string =>
	start === end ? `line:${start}` : `lines:${start}-${end}`;

const LINE_ANCHOR = /^lines?:(\d+)(?:-(\d+))?(?:\s+|$)/;

/** Splits `lines:4-9 the note` into its range and the note after it. */
export const parseLineAnchor = (
	input: string,
): {start: number; end: number; note: string} | null => {
	const match = LINE_ANCHOR.exec(input);
	if (!match) return null;

	const start = Number(match[1]);
	const end = match[2] === undefined ? start : Number(match[2]);

	return {
		start: Math.min(start, end),
		end: Math.max(start, end),
		note: input.slice(match[0].length),
	};
};

/** The file a row belongs to, for a caller that has only the cursor. */
export const fileOfRow = (rows: PatchRow[], index: number): string | null =>
	rowScopes(rows)[index]?.file ?? null;

/**
 * The selection two *line numbers* describe, in one file of the patch.
 *
 * Resolved back to rows so it goes through exactly the same refusals as a
 * range picked with the cursor — a line that is not in the new revision, or a
 * pair that spans a hunk, is refused however it was named.
 */
export const selectionFromLines = (
	rows: PatchRow[],
	filePath: string,
	start: number,
	end: number,
): {ok: true; value: RowSelection} | {ok: false; reason: string} => {
	const scopes = rowScopes(rows);

	const rowAt = (line: number) =>
		rows.findIndex(
			(row, index) =>
				scopes[index]?.file === filePath &&
				(row.kind === 'added' || row.kind === 'context') &&
				(row as PatchLine).newLine === line,
		);

	const first = rowAt(start);
	const last = rowAt(end);

	if (first === -1 || last === -1) {
		return {
			ok: false,
			reason: `${filePath} has no line ${
				first === -1 ? start : end
			} on the new side`,
		};
	}

	return selectionFromRows(rows, first, last);
};

export const selectionFromRows = (
	rows: PatchRow[],
	from: number,
	to: number,
): {ok: true; value: RowSelection} | {ok: false; reason: string} => {
	const [first, last] = from <= to ? [from, to] : [to, from];

	const head = rows[first];
	const tail = rows[last];

	if (!head || !tail)
		return {ok: false, reason: 'That line is not in the diff'};

	const anchored = (row: PatchRow) =>
		(row.kind === 'added' || row.kind === 'context') &&
		(row as PatchLine).newLine !== undefined;

	if (!anchored(head) || !anchored(tail)) {
		return {
			ok: false,
			reason:
				'Comments anchor to the new side: pick an added or unchanged line',
		};
	}

	const scopes = rowScopes(rows);
	const headScope = scopes[first]!;
	const tailScope = scopes[last]!;

	if (headScope.file !== tailScope.file) {
		return {ok: false, reason: 'A comment covers one file at a time'};
	}

	if (headScope.hunk !== tailScope.hunk) {
		return {ok: false, reason: 'A comment covers one hunk at a time'};
	}

	const within = rows.slice(first, last + 1).filter(anchored) as (PatchLine & {
		newLine: number;
	})[];

	return {
		ok: true,
		value: {
			filePath: headScope.file,
			start: within[0]!.newLine,
			end: within[within.length - 1]!.newLine,
			snippet: within.map(row => row.text).join('\n'),
		},
	};
};
