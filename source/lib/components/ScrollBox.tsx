import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';

type Props = {
	children?: React.ReactNode[];
	height: number; // height in terminal rows
	selectedIndex: number;
	itemHeight?: number;
};

export const ScrollBoxUI: React.FC<Props> = ({
	children = [],
	height,
	selectedIndex,
	itemHeight = 1,
}) => {
	if (children.length === 0) {
		return null;
	}

	const safeHeight = Math.max(1, Math.floor(height));
	const safeItemHeight = Math.max(1, Math.ceil(itemHeight));

	const visibleItemCount = Math.max(1, Math.floor(safeHeight / safeItemHeight));

	const clampedSelectedIndex = Math.max(
		0,
		Math.min(selectedIndex, children.length - 1),
	);

	const maxStart = Math.max(0, children.length - visibleItemCount);
	const start = Math.min(
		maxStart,
		Math.floor(clampedSelectedIndex / visibleItemCount) * visibleItemCount,
	);
	const end = start + visibleItemCount;

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
