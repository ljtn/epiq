import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';

type Props = {
	width: number;
	children?: React.ReactNode[];
	height: number;
	selectedIndex: number;
};

export const ScrollBoxUI: React.FC<Props> = ({
	children = [],
	height,
	selectedIndex,
}) => {
	if (children.length === 0) {
		return null;
	}
	const scrollIndex = Math.floor(Math.max(selectedIndex, 0) / height);
	const start = scrollIndex * height;
	const end = start + height;

	// Clamp values to avoid overflow
	const visibleChildren = children.slice(start, end);

	// Scrollbar calculations
	const scrollBarHeight = height;
	const scrollSteps = Math.floor(children.length / height) + 1;
	const indexBarHeight = Math.ceil(scrollBarHeight / scrollSteps);
	const barOffset = scrollIndex * indexBarHeight;

	return (
		<Box flexDirection="row">
			{/* Scrollbar */}
			{children.length > height && (
				<Box
					flexDirection="column"
					width={1}
					height={scrollBarHeight}
					marginRight={1}
				>
					{Array.from({length: scrollBarHeight}).map((_, i) => (
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
					))}
				</Box>
			)}

			<Box flexDirection="column">{visibleChildren}</Box>
		</Box>
	);
};
