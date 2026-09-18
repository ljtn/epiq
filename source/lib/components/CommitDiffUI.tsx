import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
	getCommitPatch,
	parsePatch,
	patchRows,
	PatchRow,
} from '../commits/commits.js';
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
import {truncateToWidth} from '../utils/string.utils.js';
import {ScrollBoxUI} from './ScrollBox.js';

type Props = {
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

export function CommitDiffUI({sha, subject, width, height}: Props) {
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
				? attachLineNodes(
						sha,
						rows.map(row => row.text),
						index => toRowNodeId(sha, index),
				  )
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
	const textWidth = Math.max(8, width - gutterWidth - 4);

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
			<Text color={theme.secondary2}>
				{`${sha.slice(0, 7)} ${truncateToWidth(
					subject,
					Math.max(8, width - 48),
				)} — ${note} `}
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
					? 'c to comment, s to start a range, o for your editor, q back'
					: 'move to the other end, then c to comment — s clears the mark',
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

					if (row.kind === 'file') {
						return (
							<Box key={toRowNodeId(sha, index)} paddingX={1}>
								<Text
									backgroundColor={theme.secondary}
									color={isSelected ? theme.accent : color}
								>
									{` ${truncateToWidth(row.text, textWidth)} `}
								</Text>
							</Box>
						);
					}

					const marked = inRange(index);

					return (
						<Box key={toRowNodeId(sha, index)} paddingX={1}>
							<Box flexShrink={0}>
								<Text
									color={isSelected || marked ? theme.accent : theme.secondary2}
									dimColor={!isSelected && !marked}
								>
									{`${isSelected ? '❯' : ' '}${marked ? '▌' : ' '}${rowNumber(
										row,
									).padStart(gutterWidth - 2, ' ')}`}
								</Text>
							</Box>
							<Text
								color={isSelected ? theme.accent : color}
								backgroundColor={
									isSelected || marked ? theme.secondary : undefined
								}
							>
								{` ${rowSign(row.kind)}${truncateToWidth(row.text, textWidth)}`}
							</Text>
						</Box>
					);
				})}
			</ScrollBoxUI>
		</Box>
	);
}
