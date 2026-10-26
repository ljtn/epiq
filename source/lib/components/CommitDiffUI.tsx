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
	/** The registered repo the commit is in; absent for the board's own. */
	repo?: string;
	subject: string;
	width: number;
	height: number;
};

// One nav node per row, so up/down scrolls and the cursor anchors comments.
const toRowNodeId = (sha: string, index: number) => `${sha}::patch::${index}`;

/** Control characters shown as a mark, so a patch can't drive the terminal. */
const drawable = (text: string): string =>
	expandTabs(text).replace(/[\x00-\x1f\x7f-\x9f]/g, '\ufffd');

// No syntax highlighting; `o` opens the commit in an editor.
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

// Pads with a non-breaking space (ink trims ordinary ones), in display columns
// so wide characters don't wrap the row.
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
 * The new-revision line number, blank for removed lines: one monotonic column,
 * and the number comments anchor to.
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

export function CommitDiffUI({
	ticket,
	sha,
	repo,
	subject,
	width,
	height,
}: Props) {
	const [load, setLoad] = useState<Load>({state: 'loading'});

	useEffect(() => {
		let current = true;

		setLoad({state: 'loading'});

		void getCommitPatch({sha, repo}).then(result => {
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
	}, [sha, repo]);

	const rows = load.state === 'loaded' ? load.rows : null;

	// Past the cap the editor takes it: a node per row gets expensive.
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

	// For the key handlers outside React; cleared on close.
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

	// Rows already commented, re-derived each render so a new comment shows at once.
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
	 * Columns left for the line, counted exactly: an overflowing row wraps and
	 * breaks `ScrollBoxUI`'s one-row-per-line window.
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
			{/* Truncated whole, so the header never wraps onto a second line. */}
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

					// A file is a bar across the pane, separating its hunks from the next file's.
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
										` ${truncateToWidth(drawable(row.text), textWidth)}`,
										textWidth + gutterWidth + 1,
									)}
								</Text>
							</Box>
						);
					}

					const marked = inRange(index);

					// The comment rule takes the column between number and sign.
					const body = `${rowSign(row.kind)}${truncateToWidth(
						drawable(row.text),
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
							{/* Padded on the cursor row so its highlight spans the pane. */}
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
