import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
	getCommitPatch,
	parsePatch,
	patchRows,
	PatchRow,
} from '../commits/commits.js';
import {NavNode} from '../model/navigation-node.model.js';
import {isFail, isSuccess} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {nodes} from '../state/node-builder.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {LARGE_DIFF_LINES} from '../utils/diff-size.js';
import {bigIntToHex} from '../utils/rank.js';
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

const detachRowNodes = (rowNodes: NavNode<'TEXT'>[]) => {
	for (const node of rowNodes) nodeRepo.deleteNode(node.id);
};

const attachRowNodes = (sha: string, rows: PatchRow[]): NavNode<'TEXT'>[] => {
	const created: NavNode<'TEXT'>[] = [];

	rows.forEach((row, index) => {
		const rankResult = bigIntToHex(BigInt(index + 1));
		if (!isSuccess(rankResult)) return;

		const result = nodeRepo.createNode(
			nodes.text({
				id: toRowNodeId(sha, index),
				name: row.text,
				parentNodeId: sha,
				rank: rankResult.value,
				props: {value: row.text},
				readonly: true,
				isVirtual: true,
			}),
		);

		if (isSuccess(result)) created.push(result.value as NavNode<'TEXT'>);
	});

	return created;
};

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
		detachRowNodes(rowNodesRef.current);

		rowNodesRef.current = rows && !tooLarge ? attachRowNodes(sha, rows) : [];

		return () => {
			detachRowNodes(rowNodesRef.current);
			rowNodesRef.current = [];
		};
	}, [sha, rows, tooLarge]);

	const {selectedIndex} = useAppState();

	const gutterWidth = useMemo(
		() =>
			rows
				? Math.max(
						4,
						rows.reduce(
							(widest, row) => Math.max(widest, rowNumber(row).length),
							0,
						) + 1,
				  )
				: 4,
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
			{header('q to go back, o to open in your editor')}

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

					return (
						<Box key={toRowNodeId(sha, index)} paddingX={1}>
							<Box flexShrink={0}>
								<Text color={theme.secondary2} dimColor={!isSelected}>
									{rowNumber(row).padStart(gutterWidth, ' ')}
								</Text>
							</Box>
							<Text
								color={isSelected ? theme.accent : color}
								backgroundColor={isSelected ? theme.secondary : undefined}
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
