import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useState} from 'react';
import {WORDMARK_LINES} from '../static/wordmark.js';

type Props = {
	durationMs?: number;
	slogan?: string;
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function colorizeLine(line: string, row: number) {
	const splitAt = 14;

	return (
		<Text>
			<Text color={row % 2 === 0 ? 'cyan' : 'blue'} bold>
				{line.slice(0, splitAt)}
			</Text>
			<Text color={row % 2 === 0 ? 'cyan' : 'blue'} bold>
				{line.slice(splitAt)}
			</Text>
		</Text>
	);
}

function makePulse(progress: number, width = 28) {
	if (progress >= 1) {
		return '█'.repeat(width);
	}

	const sweepCenter = Math.floor(progress * (width - 1));

	return Array.from({length: width}, (_, i) => {
		const distance = Math.abs(i - sweepCenter);

		if (distance === 0) return '█';
		if (distance === 1) return '▓';
		if (distance === 2) return '▒';
		if (distance === 3) return '░';

		return i < sweepCenter ? '─' : '·';
	}).join('');
}

export default function Logo({
	durationMs = 3_000,
	slogan = 'Never leave the command line',
}: Props) {
	const safeDurationMs = Math.max(1, durationMs);

	const [elapsedMs, setElapsedMs] = useState(0);

	useEffect(() => {
		const startedAt = Date.now();

		const timer = setInterval(() => {
			const nextElapsed = Date.now() - startedAt;

			if (nextElapsed >= safeDurationMs) {
				setElapsedMs(safeDurationMs);
				clearInterval(timer);
				return;
			}

			setElapsedMs(nextElapsed);
		}, 33);

		return () => clearInterval(timer);
	}, [safeDurationMs]);

	const progress = clamp(elapsedMs / safeDurationMs, 0, 1);
	const pulseBar = useMemo(() => makePulse(progress, 28), [progress]);
	const percentLabel = `${Math.round(progress * 100)}%`;

	return (
		<Box
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			paddingX={4}
			paddingY={1}
		>
			<Box flexDirection="column" minWidth={42}>
				<Box flexDirection="column" marginBottom={1}>
					{WORDMARK_LINES.map((line, idx) => (
						<Box key={idx} justifyContent="center">
							{colorizeLine(line, idx)}
						</Box>
					))}
				</Box>

				<Box justifyContent="center" marginBottom={1}>
					<Text color="gray">{slogan}</Text>
				</Box>

				<Box justifyContent="center" marginBottom={1}>
					<Text color="cyan">{pulseBar.slice(0, 10)}</Text>
					<Text color="blue">{pulseBar.slice(10, 18)}</Text>
					<Text color="magenta">{pulseBar.slice(18)}</Text>
				</Box>

				<Box justifyContent="center" marginBottom={1}>
					<Text color="gray">{percentLabel}</Text>
				</Box>
			</Box>
		</Box>
	);
}
