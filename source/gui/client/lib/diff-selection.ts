import {SelectedLineRange, SelectionSide} from '@pierre/diffs/react';
import {GuiComment, GuiCommitDiffFile} from './gui-state.model';
import {
	DiffCommentMeta,
	isSelectionSide,
	parseDiffCommentMeta,
} from '../../../lib/utils/diff-comment.js';

// A selection's start/end are the real (gutter-displayed) line numbers within
// whichever side they belong to — 'deletions' means the old file, 'additions'
// the new one. A range can span both sides (dragged from a removed line into
// an added one in split view): quote both halves rather than picking one.
export const extractSnippet = (
	file: GuiCommitDiffFile,
	range: SelectedLineRange,
): string => {
	const linesFor = (side: SelectedLineRange['side']) =>
		(side === 'deletions' ? file.before : file.after).split('\n');

	const endSide = range.endSide ?? range.side;

	if (endSide === range.side) {
		return linesFor(range.side)
			.slice(range.start - 1, range.end)
			.join('\n');
	}

	const startHalf = linesFor(range.side).slice(range.start - 1);
	const endHalf = linesFor(endSide).slice(0, range.end);

	return [...startHalf, ...endHalf].join('\n');
};

// Quoted lines keep their real source indentation (often several tabs deep
// inside nested JSX) — fine in the wide diff, unreadable in a narrow comment
// box. Strips the whitespace every non-blank line shares, same as most
// editors' own "copy" behavior.
export const dedent = (snippet: string): string => {
	const lines = snippet.split('\n');

	const commonIndent = lines
		.filter(line => line.trim() !== '')
		.reduce<number | null>((min, line) => {
			const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0;
			return min === null ? indent : Math.min(min, indent);
		}, null);

	if (!commonIndent) return snippet;

	return lines.map(line => line.slice(commonIndent)).join('\n');
};

export type DiffComment = {comment: GuiComment; meta: DiffCommentMeta};

/**
 * The comments whose selection was made in `sha`'s diff.
 *
 * A line number is only a place within the revision it was read from, so a
 * view that draws one revision can only place the comments belonging to it.
 * The compacted diff needs this because it shows a file at the ticket's end
 * state: a comment written against an earlier commit of the same file names
 * lines that later commits have since moved.
 */
/**
 * Whether a comment's selection lies wholly on the additions side.
 *
 * An additions-side line number is a position in the newer file, which every
 * view of that revision agrees on. A deletions-side one is a position in
 * whichever older file the view was diffing against, and views disagree about
 * that.
 */
export const isAdditionsSideComment = (comment: GuiComment): boolean => {
	const meta = parseDiffCommentMeta(comment.body);

	return meta?.side === 'additions' && meta.endSide === 'additions';
};

export const commentsByAnchor = (
	comments: GuiComment[],
): Map<string, GuiComment[]> => {
	const bySha = new Map<string, GuiComment[]>();

	for (const comment of comments) {
		const sha = parseDiffCommentMeta(comment.body)?.sha;
		if (!sha) continue;

		bySha.set(sha, [...(bySha.get(sha) ?? []), comment]);
	}

	return bySha;
};

export const findDiffCommentsForFile = (
	comments: GuiComment[],
	filePath: string,
): DiffComment[] =>
	comments.flatMap(comment => {
		if (comment.isDeleted) return [];
		const meta = parseDiffCommentMeta(comment.body);
		return meta && meta.filePath === filePath ? [{comment, meta}] : [];
	});

// What a "File ticket" submission carries up to the caller that owns the
// actual issues:create call and the origin-ticket back-comment — everything
// needed to build both without the caller re-deriving any of it.
export type FileTicketParams = {
	sha: string;
	filePath: string;
	range: SelectedLineRange;
	snippet: string;
	title: string;
	note: string;
};

/**
 * Which of the Code tab's two views a link names.
 *
 * Follows the rule `use-board-selection` already states for the board's own
 * axes: the URL wins when it says anything, a link that says nothing falls
 * back to what was last used here, and what is on screen gets written into the
 * address bar so copying it hands over what the sender was looking at.
 *
 * `diff` rather than `view`, which the board selection has taken. Named rather
 * than a boolean, because `?diff=compacted` says what it means where
 * `?compacted=1` says it only to whoever wrote it.
 */
export const DIFF_VIEW_PARAM = 'diff';

export type DiffViewName = 'commits' | 'flat';

// `compacted` is what the flat view was called when the param shipped. Still
// read, never written: an unrecognised value falls back to the reader's own
// view, so dropping the old spelling would land an already-shared link in the
// wrong one — the failure putting the view in the route exists to prevent.
const DIFF_VIEW_NAMES = new Map<string, DiffViewName>([
	['commits', 'commits'],
	['flat', 'flat'],
	['compacted', 'flat'],
]);

/** Null for absent *and* for unrecognised: a view nobody offers is no request
 * at all, so the reader's own choice stands rather than being overridden by a
 * typo. */
export const readDiffViewParam = (
	params: URLSearchParams,
): DiffViewName | null =>
	DIFF_VIEW_NAMES.get(params.get(DIFF_VIEW_PARAM) ?? '') ?? null;

export const writeDiffViewParam = (
	params: URLSearchParams,
	flat: boolean,
): void => {
	params.set(DIFF_VIEW_PARAM, flat ? 'flat' : 'commits');
};

export const clearDiffViewParam = (params: URLSearchParams): void => {
	params.delete(DIFF_VIEW_PARAM);
};

// A spot in a ticket's Code tab, deep-linkable from a comment. Lives in the
// URL rather than in transient state so the link survives a reload and can be
// handed to someone else.
export type DiffLocation = {
	sha: string;
	filePath: string;
	start: number;
	end: number;
	side: SelectionSide;
	endSide: SelectionSide;
	// Set when the diff lives on another ticket's Code tab.
	issueRef?: string;
};

export const diffLocationFromMeta = (
	meta: DiffCommentMeta,
): DiffLocation | null =>
	meta.sha
		? {
				sha: meta.sha,
				filePath: meta.filePath,
				start: meta.start,
				end: meta.end,
				side: meta.side,
				endSide: meta.endSide,
				...(meta.issueRef ? {issueRef: meta.issueRef} : {}),
		  }
		: null;

const DIFF_LOCATION_PARAMS = [
	'commit',
	'file',
	'from',
	'to',
	'side',
	'endSide',
] as const;

export const writeDiffLocationParams = (
	params: URLSearchParams,
	location: DiffLocation,
): void => {
	params.set('commit', location.sha);
	params.set('file', location.filePath);
	params.set('from', String(location.start));
	params.set('to', String(location.end));
	params.set('side', location.side);
	params.set('endSide', location.endSide);
};

// A deep link that names only a commit: open it, nothing narrower to show.
// A full DiffLocation is one of these too.
export type CommitFocus = {sha: string} & Partial<Omit<DiffLocation, 'sha'>>;

export const readCommitFocusParam = (
	params: URLSearchParams,
): CommitFocus | null => {
	const sha = params.get('commit');
	if (!sha) return null;

	// `file` without a line range: what the Stats tab links with, since it
	// names a file rather than a spot inside one. The Code tab already
	// opens `focus.filePath` when it has one.
	const filePath = params.get('file');

	return filePath ? {sha, filePath} : {sha};
};

/** The Stats tab's link: a file, in the commit that last touched it. */
export const writeFileFocusParams = (
	params: URLSearchParams,
	file: {sha: string; path: string},
): void => {
	clearDiffLocationParams(params);
	params.set('commit', file.sha);
	params.set('file', file.path);
};

export const clearDiffLocationParams = (params: URLSearchParams): void => {
	for (const key of DIFF_LOCATION_PARAMS) params.delete(key);
};

export const readDiffLocationParams = (
	params: URLSearchParams,
): DiffLocation | null => {
	const sha = params.get('commit');
	const filePath = params.get('file');
	const start = Number(params.get('from'));
	const end = Number(params.get('to'));
	const side = params.get('side');
	const endSide = params.get('endSide');

	if (
		!sha ||
		!filePath ||
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		!isSelectionSide(side) ||
		!isSelectionSide(endSide)
	) {
		return null;
	}

	return {sha, filePath, start, end, side, endSide};
};
