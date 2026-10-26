import {DiffCommentMeta, parseDiffCommentMeta} from '../utils/diff-comment.js';

// What a unified patch says, as rows a terminal can draw. Git's own patch, so
// renames, binaries and line numbers match git.

export type PatchLineKind = 'context' | 'added' | 'removed' | 'hunk' | 'note';

export type PatchLine = {
	kind: PatchLineKind;
	text: string;
	// Line numbers in the old and new revision; absent on the side a line isn't in.
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
			// Fallback name for files with no `+++` line (binary, mode-only); `+++`
			// overrides it.
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

		// Header until the first hunk; after it, `---`/`+++` lines are content.
		const inHeader = current.lines.length === 0;

		if (inHeader && row.startsWith('--- ')) {
			const path = stripPrefix(row.slice(4));
			if (path) current.oldPath = path;
			continue;
		}

		if (inHeader && row.startsWith('+++ ')) {
			const path = stripPrefix(row.slice(4));
			if (path) current.path = path;
			continue;
		}

		if (inHeader && row.startsWith('rename from ')) {
			current.oldPath = unquotePath(row.slice('rename from '.length));
			continue;
		}

		if (inHeader && row.startsWith('rename to ')) {
			current.path = unquotePath(row.slice('rename to '.length));
			continue;
		}

		if (
			inHeader &&
			(row.startsWith('Binary files ') || row.startsWith('GIT binary patch'))
		) {
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

		// The rest of the header — index, mode, similarity — says nothing the
		// rows below do not say more plainly.
		if (inHeader) continue;

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

/** Every file's rows as one flat list, each headed by its path. */
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
 * Rows already commented on, matched on the same commit only: a line number
 * means nothing in another revision.
 */
export const commentedRows = (
	rows: PatchRow[],
	comments: {md: string}[],
	sha: string,
): Set<number> => {
	const anchors = comments
		.map(comment => parseDiffCommentMeta(comment.md))
		.filter(
			(meta): meta is DiffCommentMeta =>
				meta !== null && meta.sha === sha && meta.side === 'additions',
		);

	if (anchors.length === 0) return new Set();

	const scopes = rowScopes(rows);
	const marked = new Set<number>();

	rows.forEach((row, index) => {
		const line = (row as PatchLine).newLine;
		if (line === undefined) return;

		const file = scopes[index]?.file;

		if (
			anchors.some(
				meta =>
					meta.filePath === file && meta.start <= line && line <= meta.end,
			)
		) {
			marked.add(index);
		}
	});

	return marked;
};

/** A selection's lines as the command line shows them, e.g. `lines:4-9`. */
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
 * The selection two line numbers describe, resolved to rows so it gets the
 * same refusals as a cursor range.
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

/**
 * The selection two rows describe, or why they describe none. New-side lines
 * only, within one hunk, so the snippet matches the GUI's.
 */
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
