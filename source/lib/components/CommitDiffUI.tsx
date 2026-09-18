import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
	commentedRows,
	getCommitPatch,
	parsePatch,
	patchRows,
	PatchRow,
} from '../commits/commits.js';
import {Ticket} from '../model/context.model.js';
import {nodeRepo} from '../repository/node-repo.js';
import {NavNode} from '../model/navigation-node.model.js';
import {isFail} from '../model/result-types.js';
import {attachLineNodes, detachLineNodes} from '../repository/line-nodes.js';
import {
	setDiffMark,
	setOpenPatch,
	useDiffPagerState,
} from '../state/diff-pager.state.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {LARGE_DIFF_LINES} from '../utils/diff-size.js';
import {expandTabs} from '../utils/markdown-lite.js';
import stringWidth from 'string-width';
import {truncateToWidth} from '../utils/string.utils.js';
import {ScrollBoxUI} from './ScrollBox.js';

type Props = {
	ticket: Ticket;
	sha: string;
	subject: string;
	width: number;
	height: number;
};

// One nav node per row, the way InlineEditor does it for the event log: the
// TUI's own up/down then scrolls the patch, and the cursor it leaves behind is
// what a comment will later be anchored to.
const toRowNodeId = (sha: string, index: number) => `${sha}::patch::${index}`;

// No syntax highlighting: added, removed, context and the hunk header is what
// a diff is, and a terminal says it in four colours without a grammar for
// every language in the repo. `o` opens the commit in a real editor when the
// code's own colours are what you want.
const rowColor = (kind: PatchRow['kind']): string => {
	switch (kind) {
		case 'added':
			return theme.green;
		case 'removed':
			return theme.red;
		case 'hunk':
			return theme.accent;
		case 'file':
			return theme.primary;
		default:
			return theme.secondary2;
	}
};

// Padded with a non-breaking space: ink trims a trailing ordinary one, and
// the padding is there to carry a background colour to the edge.
//
// Measured in display columns, not characters, because that is what the text
// beside it was cut to: a line of CJK or emoji is half as many characters as
// it is columns wide, and padding by character count would push the row past
// the pane and have ink wrap it onto a second terminal line.
export const padTo = (text: string, width: number): string => {
	const used = stringWidth(text);

	return used >= width ? text : text + ' '.repeat(width - used);
};

const rowSign = (kind: PatchRow['kind']): string => {
	if (kind === 'added') return '+';
	if (kind === 'removed') return '-';
	return ' ';
};

/**
 * The row's line number in the *new* revision, and nothing for a removed line.
 *
 * Numbering each row on whichever side it belongs to reads as a column that
 * counts 1, 2, 3, 3, 5, 4 — two interleaved sequences that look like one
 * broken one. One side counts monotonically, and the `-` already says a
 * removed line is not in the new file.
 *
 * It is also the only number worth showing: a new-revision line number means
 * the same thing in every view of that revision, which is what lets a comment
 * be anchored to it. An old-side number is a position in whatever this diff
 * happened to be against.
 */
const rowNumber = (row: PatchRow): string => {
	if (row.kind === 'file' || row.kind === 'hunk' || row.kind === 'note') {
		return '';
	}

	return row.newLine === undefined ? '' : String(row.newLine);
};

type Load =
	| {state: 'loading'}
	| {state: 'failed'; message: string}
	| {state: 'loaded'; rows: PatchRow[]};

export function CommitDiffUI({ticket, sha, subject, width, height}: Props) {
	const [load, setLoad] = useState<Load>({state: 'loading'});

	useEffect(() => {
		let current = true;

		setLoad({state: 'loading'});

		void getCommitPatch({sha}).then(result => {
			if (!current) return;

			setLoad(
				isFail(result)
					? {state: 'failed', message: result.message}
					: {state: 'loaded', rows: patchRows(parsePatch(result.value))},
			);
		});

		return () => {
			current = false;
		};
	}, [sha]);

	const rows = load.state === 'loaded' ? load.rows : null;

	// A patch is sized by what changed rather than by how big the files are, so
	// the lockfile that defeats the GUI's blob-based check is usually a handful
	// of rows here. A rewrite of one is not, and a node per row is what makes
	// that expensive — so past the cap the editor takes it.
	const tooLarge = rows !== null && rows.length > LARGE_DIFF_LINES;

	const rowNodesRef = useRef<NavNode<'TEXT'>[]>([]);

	useEffect(() => {
		detachLineNodes(rowNodesRef.current);

		rowNodesRef.current =
			rows && !tooLarge
				? attachLineNodes(sha, rows.length, index => toRowNodeId(sha, index))
				: [];

		return () => {
			detachLineNodes(rowNodesRef.current);
			rowNodesRef.current = [];
		};
	}, [sha, rows, tooLarge]);

	// The key handlers run outside React and need these same rows to work out
	// what `c` selected. Cleared on the way out so a keystroke arriving after
	// the pager closes finds nothing rather than the last patch read.
	useEffect(() => {
		setOpenPatch(rows ? {sha, rows} : null);
		setDiffMark(null);

		return () => {
			setOpenPatch(null);
			setDiffMark(null);
		};
	}, [sha, rows]);

	const {selectedIndex} = useAppState();
	const {mark} = useDiffPagerState();

	// Which rows already carry a comment. Derived from the ticket's own
	// comments, which the board already holds — re-read on every render of the
	// ticket so a comment written here shows against its line straight away.
	const commented = useMemo(
		() =>
			rows
				? commentedRows(rows, nodeRepo.getCommentsByIssue(ticket.id), sha)
				: new Set<number>(),
		[rows, sha, ticket],
	);

	// The rows between the mark and the cursor, so a range being built is
	// visible while it is built.
	const markedRow = mark && mark.sha === sha ? mark.row : null;
	const inRange = (index: number) =>
		markedRow !== null &&
		index >= Math.min(markedRow, selectedIndex) &&
		index <= Math.max(markedRow, selectedIndex);

	const gutterWidth = useMemo(
		() =>
			// Two columns of their own before the number: the cursor and the mark.
			rows
				? Math.max(
						5,
						rows.reduce(
							(widest, row) => Math.max(widest, rowNumber(row).length),
							0,
						) + 2,
				  )
				: 5,
		[rows],
	);

	// Two rows of chrome above (the header and its rule), one of padding below.
	const scrollHeight = Math.max(1, height - 4);

	/**
	 * Columns left for the line itself.
	 *
	 * Counted rather than estimated, because a row that overflows does not get
	 * clipped — ink wraps it onto a second terminal line, and then every row is
	 * two rows tall while `ScrollBoxUI` is being told each is one. The window it
	 * computes is then wrong by however many rows happened to be long, which
	 * reads as a pager that will not scroll to its own top.
	 *
	 * Spent on: the ticket pane's right padding, this row's own padding either
	 * side, the gutter, the space and sign before the text, and the column the
	 * scroll box keeps for its bar.
	 */
	const textWidth = Math.max(8, width - gutterWidth - 6);

	if (load.state !== 'loaded') {
		return (
			<Box flexDirection="column" width={width} height={height} padding={1}>
				<Text color={theme.primary}>
					{load.state === 'loading'
						? 'Reading the diff…'
						: `Could not read the diff: ${load.message}`}
				</Text>
			</Box>
		);
	}

	const header = (note: string) => (
		<Box
			paddingLeft={4}
			borderLeft={false}
			borderRight={false}
			borderBottom={false}
			borderTop={true}
			borderColor={theme.secondary}
			borderStyle="single"
			paddingBottom={1}
		>
			{/* Truncated whole rather than by its parts: cutting the subject alone
			    left the keys after it to overflow, and a header that wraps onto a
			    second line steals a row from the patch on every narrow terminal. */}
			<Text color={theme.secondary2} wrap="truncate-end">
				{truncateToWidth(
					`${sha.slice(0, 7)} ${subject} — ${note}`,
					Math.max(8, width - 6),
				)}
			</Text>
		</Box>
	);

	if (load.rows.length === 0) {
		return (
			<Box flexDirection="column" width={width} height={height}>
				{header('no changes')}
				<Box paddingX={1}>
					<Text color={theme.primary}>This commit changed no files.</Text>
				</Box>
			</Box>
		);
	}

	if (tooLarge) {
		return (
			<Box flexDirection="column" width={width} height={height}>
				{header('too large to draw here')}
				<Box paddingX={1} flexDirection="column">
					<Text color={theme.primary}>
						{`${load.rows.length.toLocaleString()} lines of diff.`}
					</Text>
					<Text color={theme.secondary2}>
						Press o to open it in your editor.
					</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" width={width} height={height}>
			{header(
				markedRow === null
					? 'enter to comment on a line, s to start a range, o editor, q back'
					: 'move to the other end, then enter to comment — s clears the mark',
			)}

			<ScrollBoxUI
				scrollByOne={true}
				height={scrollHeight}
				selectedIndex={selectedIndex}
				itemHeight={1}
			>
				{load.rows.map((row, index) => {
					const isSelected = index === selectedIndex;
					const color = rowColor(row.kind);

					// A file reads as a bar across the pane rather than a chip around
					// its name, which is the only thing that separates one file’s
					// hunks from the next one’s while scrolling past.
					if (row.kind === 'file') {
						return (
							<Box key={toRowNodeId(sha, index)} paddingX={1}>
								<Text
									backgroundColor={theme.secondary}
									color={isSelected ? theme.accent : color}
									bold
									wrap="truncate-end"
								>
									{padTo(
										` ${truncateToWidth(expandTabs(row.text), textWidth)}`,
										textWidth + gutterWidth + 1,
									)}
								</Text>
							</Box>
						);
					}

					const marked = inRange(index);

					// The margin rule takes the column that already sat between the
					// number and the sign, so saying a line carries a comment costs
					// the code none of its width.
					const body = `${rowSign(row.kind)}${truncateToWidth(
						expandTabs(row.text),
						textWidth,
					)}`;

					return (
						<Box key={toRowNodeId(sha, index)} paddingX={1}>
							<Box flexShrink={0}>
								<Text
									color={isSelected || marked ? theme.accent : theme.secondary2}
									dimColor={!isSelected && !marked}
									wrap="truncate-end"
								>
									{`${isSelected ? '❯' : ' '}${marked ? '▌' : ' '}${rowNumber(
										row,
									).padStart(gutterWidth - 2, ' ')}`}
								</Text>
							</Box>
							{/* Its own colour, not the cursor’s: the cursor moves and this
							    does not, so they must not read as the same thing. */}
							<Box flexShrink={0}>
								<Text color={theme.yellow} wrap="truncate-end">
									{commented.has(index) ? '│' : ' '}
								</Text>
							</Box>
							{/* Padded out on the row the cursor is on, so its highlight is a
							    band across the pane rather than a stub around whatever the
							    line happened to contain — a blank added line otherwise
							    highlights two characters and looks like damage. */}
							<Text
								color={isSelected ? theme.accent : color}
								backgroundColor={
									isSelected || marked ? theme.secondary : undefined
								}
								wrap="truncate-end"
							>
								{isSelected || marked ? padTo(body, textWidth + 1) : body}
							</Text>
						</Box>
					);
				})}
			</ScrollBoxUI>
		</Box>
	);
}
