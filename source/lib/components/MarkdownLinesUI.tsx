import {Box, Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';
import {RenderedLine, Span} from '../utils/markdown-lite.js';

const SpansUI = ({spans, bold}: {spans: Span[]; bold?: boolean}) => (
	<Text color={theme.primary} bold={bold}>
		{spans.map((span, index) =>
			span.code ? (
				<Text key={index} color={theme.yellow}>
					{span.text}
				</Text>
			) : (
				<Text key={index}>{span.text}</Text>
			),
		)}
	</Text>
);

// One rendered line. `width` is what a code line is padded to, so a fenced
// block reads as a block rather than a ragged right edge.
export const RenderedLineUI = ({
	line,
	width,
	gutter = 0,
}: {
	line: RenderedLine;
	width: number;
	gutter?: number;
}) => {
	switch (line.kind) {
		case 'blank':
			return <Text> </Text>;
		case 'fence':
			return <Text color={theme.secondary2}>```</Text>;
		case 'caption':
			return <Text color={theme.accent}>{line.text}</Text>;
		case 'heading':
			return <SpansUI spans={line.spans} bold />;
		case 'text':
			return <SpansUI spans={line.spans} />;
		case 'code': {
			const number =
				gutter > 0
					? `${line.number === undefined ? '' : String(line.number)}`.padStart(
							gutter - 3,
					  ) + ' │ '
					: '';
			return (
				<Text backgroundColor={theme.secondary} color={theme.primary}>
					{number}
					{line.text.padEnd(Math.max(0, width - number.length))}
				</Text>
			);
		}
	}
};

export const MarkdownLinesUI = ({
	lines,
	width,
}: {
	lines: RenderedLine[];
	width: number;
}) => {
	const numbers = lines.flatMap(line =>
		line.kind === 'code' && line.number !== undefined ? [line.number] : [],
	);
	const gutter =
		numbers.length > 0 ? String(Math.max(...numbers)).length + 3 : 0;

	return (
		<Box flexDirection="column">
			{lines.map((line, index) => (
				<Box key={index}>
					<RenderedLineUI line={line} width={width} gutter={gutter} />
				</Box>
			))}
		</Box>
	);
};
