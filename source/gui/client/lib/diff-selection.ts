import {SelectedLineRange, SelectionSide} from '@pierre/diffs/react';
import {GuiComment, GuiCommitDiffFile} from './gui-state.model';
import {
	DiffCommentMeta,
	extractSnippet,
	isSelectionSide,
	parseDiffCommentMeta,
} from '../../../lib/utils/diff-comment.js';

// Re-exported so the components that quote a selection keep one import.
export {extractSnippet};

export type DiffComment = {comment: GuiComment; meta: DiffCommentMeta};

/**
 * Whether a comment's selection lies wholly on the additions side, whose line
 * numbers every view of the revision agrees on.
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

// What a "File ticket" submission hands the caller that creates the issue and
// its back-comment.
export type FileTicketParams = {
	sha: string;
	filePath: string;
	range: SelectedLineRange;
	snippet: string;
	title: string;
	note: string;
};

/**
 * Which of the Code tab's two views a link names. The URL wins when it says
 * anything, else the last view used here.
 */
export const DIFF_VIEW_PARAM = 'diff';

export type DiffViewName = 'commits' | 'flat';

// `compacted` is the flat view's older name: still read, never written.
const DIFF_VIEW_NAMES = new Map<string, DiffViewName>([
	['commits', 'commits'],
	['flat', 'flat'],
	['compacted', 'flat'],
]);

/** Null for absent and for unrecognised, so the reader's own choice stands. */
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

// A spot in a ticket's Code tab, kept in the URL so a link survives a reload.
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

// `start`/`end`, not `from`/`to`: those are the board's zoom window, which
// shares this query string.
const DIFF_LOCATION_PARAMS = [
	'commit',
	'file',
	'start',
	'end',
	'side',
	'endSide',
] as const;

export const writeDiffLocationParams = (
	params: URLSearchParams,
	location: DiffLocation,
): void => {
	params.set('commit', location.sha);
	params.set('file', location.filePath);
	params.set('start', String(location.start));
	params.set('end', String(location.end));
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

	// `file` without a line range, as the Stats tab links.
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
	const start = Number(params.get('start'));
	const end = Number(params.get('end'));
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
