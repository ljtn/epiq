import chalk from 'chalk';
import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {AppState} from '../model/app-state.model.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';

interface Props {
	width: number;
	mode: ModeUnion;
	availableHints: AppState['availableHints'];
}

const SYNC_GRADIENT = [
	'#4c567a', // gray
	'#9d7cd8', // magenta
	'#7aa2f7', // blue
	'#7dcfff', // cyan
	'#9d7cd8', // magenta
];

const hexToRgb = (hex: string) => {
	const clean = hex.replace('#', '');
	return {
		r: parseInt(clean.slice(0, 2), 16),
		g: parseInt(clean.slice(2, 4), 16),
		b: parseInt(clean.slice(4, 6), 16),
	};
};

const rgbToHex = ({r, g, b}: {r: number; g: number; b: number}) => {
	const toHex = (value: number) =>
		Math.round(Math.max(0, Math.min(255, value)))
			.toString(16)
			.padStart(2, '0');

	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const mixHex = (from: string, to: string, t: number) => {
	const a = hexToRgb(from);
	const b = hexToRgb(to);

	return rgbToHex({
		r: a.r + (b.r - a.r) * t,
		g: a.g + (b.g - a.g) * t,
		b: a.b + (b.b - a.b) * t,
	});
};

const getGradientColor = (colors: string[], progress: number) => {
	if (colors.length === 1) return colors[0];

	const scaled = progress * (colors.length - 1);
	const index = Math.floor(scaled);
	const localT = scaled - index;

	const from = colors[index]!;
	const to = colors[Math.min(index + 1, colors.length - 1)]!;

	return mixHex(from, to, localT);
};

const padOrTrim = (value: string, width: number) => {
	if (value.length === width) return value;
	if (value.length > width) return value.slice(0, width);
	return value.padEnd(width, ' ');
};

export const ContextBarInfo: React.FC<Props> = ({width, availableHints}) => {
	const {
		syncStatus: {status, msg},
	} = useAppState();

	const [tick, setTick] = useState(0);

	useEffect(() => {
		if (status !== 'syncing') {
			setTick(0);
			return;
		}

		const id = setInterval(() => {
			setTick(prev => prev + 1);
		}, 50);

		return () => clearInterval(id);
	}, [status]);

	const clampedHints: string[] = [];
	let usedWidth = 0;

	for (const hint of availableHints) {
		const separator = clampedHints.length > 0 ? ' | ' : '';
		const nextWidth = separator.length + hint.length;

		if (usedWidth + nextWidth > width - 4) break;

		clampedHints.push(hint);
		usedWidth += nextWidth;
	}

	const hintLine =
		status != 'synced'
			? msg ?? clampedHints.join(' | ')
			: clampedHints.join(' | ');
	const innerWidth = Math.max(0, width - 2);

	const borderColor =
		status === 'syncing'
			? getGradientColor(SYNC_GRADIENT, (Math.sin(tick * 0.12) + 1) / 2)
			: theme.secondary;

	const border = chalk.hex(borderColor);
	const contentColor = chalk.hex(theme.secondary2);

	const topBorder = border(`╭${'─'.repeat(innerWidth)}╮`);
	const bottomBorder = border(`╰${'─'.repeat(innerWidth)}╯`);
	const middleLine = `${border('│')}${contentColor(
		padOrTrim(` ${hintLine} `, innerWidth),
	)}${border('│')}`;

	return (
		<Box flexDirection="column" width={width}>
			<Text>{topBorder}</Text>
			<Text>{middleLine}</Text>
			<Text>{bottomBorder}</Text>
		</Box>
	);
};
