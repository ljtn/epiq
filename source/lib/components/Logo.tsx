import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useState} from 'react';
const logoLines = [
	'███████╗██████╗ ██╗ ██████╗ ',
	'██╔════╝██╔══██╗██║██╔═══██╗',
	'█████╗  ██████╔╝██║██║   ██║',
	'██╔══╝  ██╔═══╝ ██║██║▄▄ ██║',
	'███████╗██║     ██║╚██████╔╝',
	'╚══════╝╚═╝     ╚═╝ ╚══▀▀═╝ ',
];

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const loadingMessages = ['Awakening', 'Remembering', 'Materializing'];

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

function makePulse(step: number, width = 28) {
	const center = step % width;

	return Array.from({length: width}, (_, i) => {
		const distance = Math.abs(i - center);
		if (distance === 0) return '█';
		if (distance === 1) return '▓';
		if (distance === 2) return '▒';
		if (distance === 3) return '░';
		return '·';
	}).join('');
}

export default function Logo() {
	const [frame, setFrame] = useState(0);
	const [messageIndex, setMessageIndex] = useState(0);

	useEffect(() => {
		const spinnerTimer = setInterval(() => {
			setFrame(prev => prev + 1);
		}, 80);

		const messageTimer = setInterval(() => {
			setMessageIndex(prev => (prev + 1) % loadingMessages.length);
		}, 1000);

		return () => {
			clearInterval(spinnerTimer);
			clearInterval(messageTimer);
		};
	}, []);

	const spinner = frames[frame % frames.length];
	const pulseBar = useMemo(() => makePulse(frame, 28), [frame]);

	return (
		<Box
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			paddingX={4}
			paddingY={1}
		>
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor="cyan"
				paddingX={4}
				paddingY={1}
				minWidth={42}
			>
				<Box flexDirection="column" marginBottom={1}>
					{logoLines.map((line, idx) => (
						<Box key={idx} justifyContent="center">
							{colorizeLine(line, idx)}
						</Box>
					))}
				</Box>

				<Box flexDirection="column" alignItems="center" marginBottom={1}>
					<Text color="greenBright" bold>
						EPIQ CLI
					</Text>
				</Box>

				<Box justifyContent="center" marginBottom={1}>
					<Text color="gray">Never leave the command line</Text>
				</Box>

				<Box justifyContent="center" marginBottom={1}>
					<Text color="cyan">{pulseBar.slice(0, 10)}</Text>
					<Text color="blue">{pulseBar.slice(10, 18)}</Text>
					<Text color="magenta">{pulseBar.slice(18)}</Text>
				</Box>

				<Box justifyContent="center">
					<Text color="yellow" bold>
						{spinner}
					</Text>
					<Text> </Text>
					<Text color="white">{loadingMessages[messageIndex]}</Text>
					<Text color="gray">...</Text>
				</Box>
			</Box>
		</Box>
	);
}
