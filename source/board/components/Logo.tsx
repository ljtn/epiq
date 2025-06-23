import {Box, Text} from 'ink';
import {highlight} from '../render/color.js';
import React from 'react';

function replaceRange(
	str: string,
	start: number,
	end: number,
	replacement: string,
): string {
	return str.slice(0, start) + replacement + str.slice(end);
}

const logoLines = [
	` ______ _____   _____   _____`,
	`|  ____|  __ \\ |_   _| / ____|`,
	`| |__  |  |__)\\  | |  | |     `,
	`|  __| |   ___/  | |  | |     `,
	`| |____|  |     _| |_ | |____ `,
	`|______|__|    |_____| \\____ |`,
	`                           (_|`,
];
const coloredLogo = logoLines
	.map(line => replaceRange(line, 0, 7, highlight(line.slice(0, 7), 'cyan')))
	.map(line =>
		replaceRange(line, 31, 39, highlight(line.slice(31, 39), 'yellow')),
	);

export default function Logo() {
	return (
		<Box flexDirection="column" marginBottom={1}>
			{coloredLogo.map((line, idx) => (
				<Text key={idx}>{line}</Text>
			))}
		</Box>
	);
}
