import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';

type Props = {
	children?: React.ReactNode[];
	height: number; // height in terminal rows
	selectedIndex: number;
	itemHeight?: number;
	// Per-child heights, for children that are not all the same size. The
	// window then holds whichever run of children fits around the selection.
	itemHeights?: number[];
	scrollByOne?: boolean;
};

const windowByHeights = (
	heights: number[],
	count: number,
	selected: number,
	height: number,
): {start: number; end: number} => {
	const heightAt = (index: number) => Math.max(1, heights[index] ?? 1);

	let start = selected;
	let end = selected + 1;
	let used = heightAt(selected);

	while (end < count && used + heightAt(end) <= height) {
		used += heightAt(end);
		end++;
	}
	while (start > 0 && used + heightAt(start - 1) <= height) {
		start--;
		used += heightAt(start);
	}

	return {start, end};
};

export const ScrollBoxUI: React.FC<Props> = ({
	children = [],
	height,
	selectedIndex,
	itemHeight = 1,
	itemHeights,
	scrollByOne = false,
}) => {
	if (children.length === 0) {
		return null;
	}

	const safeHeight = Math.max(1, Math.floor(height));
	const safeItemHeight = Math.max(1, Math.ceil(itemHeight));

	const clampedSelectedIndex = Math.max(
		0,
		Math.min(selectedIndex, children.length - 1),
	);

	const uniformVisibleCount = Math.max(
		1,
		Math.floor(safeHeight / safeItemHeight),
	);
	const maxStart = Math.max(0, children.length - uniformVisibleCount);

	const {start, end} = itemHeights
		? windowByHeights(
				itemHeights,
				children.length,
				clampedSelectedIndex,
				safeHeight,
		  )
		: scrollByOne
		? {
				start: Math.min(
					maxStart,
					Math.max(0, clampedSelectedIndex - uniformVisibleCount + 1),
				),
				end:
					Math.min(
						maxStart,
						Math.max(0, clampedSelectedIndex - uniformVisibleCount + 1),
					) + uniformVisibleCount,
		  }
		: {
				start: Math.min(
					maxStart,
					Math.floor(clampedSelectedIndex / uniformVisibleCount) *
						uniformVisibleCount,
				),
				end:
					Math.min(
						maxStart,
						Math.floor(clampedSelectedIndex / uniformVisibleCount) *
							uniformVisibleCount,
					) + uniformVisibleCount,
		  };

	const visibleItemCount = Math.max(1, end - start);
	const visibleChildren = children.slice(start, end);

	const showScrollbar = children.length > visibleItemCount;
	const scrollBarHeight = safeHeight;

	const thumbHeight = showScrollbar
		? Math.max(
				1,
				Math.floor((visibleItemCount / children.length) * scrollBarHeight),
		  )
		: scrollBarHeight;

	const maxThumbOffset = Math.max(0, scrollBarHeight - thumbHeight);
	const maxScrollStart = Math.max(1, children.length - visibleItemCount);

	const thumbOffset = showScrollbar
		? Math.floor((start / maxScrollStart) * maxThumbOffset)
		: 0;

	return (
		<Box flexDirection="row" height={safeHeight} width="100%">
			<Box flexDirection="column" flexGrow={1} height={safeHeight}>
				{visibleChildren}
			</Box>

			{/* Held even when idle, and counted in inline-editor-layout.ts */}
			<Box flexDirection="column" width={1} height={scrollBarHeight}>
				{Array.from({length: scrollBarHeight}).map((_, i) => (
					<Text
						key={i}
						color={
							showScrollbar && i >= thumbOffset && i < thumbOffset + thumbHeight
								? theme.accent
								: theme.secondary
						}
					>
						{showScrollbar ? '│' : ' '}
					</Text>
				))}
			</Box>
		</Box>
	);
};
