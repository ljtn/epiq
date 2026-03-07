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

	const visibleItemCount = Math.max(1, Math.floor(height / itemHeight));
	const clampedSelectedIndex = Math.max(
		0,
		Math.min(selectedIndex, children.length - 1),
	);

	const scrollIndex = Math.floor(clampedSelectedIndex / visibleItemCount);
	const start = scrollIndex * visibleItemCount;
	const end = start + visibleItemCount;

	const visibleChildren = children.slice(start, end);

	const scrollBarHeight = height;
	const scrollSteps = Math.max(
		1,
		Math.ceil(children.length / visibleItemCount),
	);
	const indexBarHeight = Math.max(1, Math.ceil(scrollBarHeight / scrollSteps));
	const maxBarOffset = Math.max(0, scrollBarHeight - indexBarHeight);
	const barOffset =
		scrollSteps <= 1
			? 0
			: Math.min(
					maxBarOffset,
					Math.round((scrollIndex / (scrollSteps - 1)) * maxBarOffset),
			  );

	const showScrollbar = children.length > visibleItemCount;

	return (
		<Box flexDirection="row" height={height} width="100%">
			<Box flexDirection="column" flexGrow={1}>
				{visibleChildren}
			</Box>

			<Box flexDirection="column" width={1} height={scrollBarHeight}>
				{showScrollbar
					? Array.from({length: scrollBarHeight}).map((_, i) => (
							<Text
								key={i}
								color={
									i >= barOffset && i < barOffset + indexBarHeight
										? theme.accent
										: theme.secondary
								}
							>
								│
							</Text>
					  ))
					: Array.from({length: scrollBarHeight}).map((_, i) => (
							<Text key={i}></Text>
					  ))}
			</Box>
		</Box>
	);
};
