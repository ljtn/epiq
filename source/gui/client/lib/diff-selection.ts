import React from 'react';
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

// A spot in a ticket's Commits tab, deep-linkable from a comment. Lives in the
// URL rather than in transient state so the link survives a reload and can be
// handed to someone else.
export type DiffLocation = {
	sha: string;
	filePath: string;
	start: number;
	end: number;
	side: SelectionSide;
	endSide: SelectionSide;
	// Set when the diff lives on another ticket's Commits tab.
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
	return sha ? {sha} : null;
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
