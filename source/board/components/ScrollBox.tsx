import {Box, Text} from 'ink';
import React from 'react';

type Props = {
	width: number;
	children?: React.ReactNode[];
	size: number;
	selectedIndex: number;
};

export const ScrollBoxUI: React.FC<Props> = ({
	children = [],
	size,
	selectedIndex,
}) => {
	if (children.length === 0) {
		return null;
	}

	const scrollIndex = Math.floor(Math.max(selectedIndex, 0) / size);
	const start = scrollIndex * size;
	const end = start + size;

	// Clamp values to avoid overflow
	const visibleChildren = children.slice(start, end);

	// Scrollbar calculations
	const scrollBarHeight = size;
	const scrollSteps = Math.floor(children.length / size) + 1;
	const indexBarHeight = Math.ceil(scrollBarHeight / scrollSteps);
	const barOffset = scrollIndex * indexBarHeight;

	return (
		<Box flexDirection="row">
			{/* Scrollbar */}
			{children.length > size && (
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
									? 'green'
									: 'gray'
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
