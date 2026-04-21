import {Box, Text} from 'ink';
import React, {useEffect, useMemo, useState} from 'react';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';

const FRAMES = ['⠁', '⠂', '⠄', '⠂'];
const WIDTH = 10;

// gray -> magenta -> blue -> cyan -> magenta
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
export const SyncStatusBadge: React.FC = () => {
	const {
		syncStatus: {status, msg},
	} = useAppState();

	const [frameIndex, setFrameIndex] = useState(0);
	const [colorTick, setColorTick] = useState(0);

	useEffect(() => {
		if (status !== 'syncing') {
			setFrameIndex(0);
			setColorTick(0);
			return;
		}

		const frameId = setInterval(() => {
			setFrameIndex(prev => (prev + 1) % FRAMES.length);
		}, 120);

		const colorId = setInterval(() => {
			setColorTick(prev => prev + 1);
		}, 50);

		return () => {
			clearInterval(frameId);
			clearInterval(colorId);
		};
	}, [status]);

	const {label, icon} = useMemo(() => {
		if (status === 'syncing') {
			return {
				label: `syncing${msg ? ` ${msg}` : ''}`,
				icon: FRAMES[frameIndex],
			};
		}

		if (status === 'synced') {
			return {
				label: `synced${msg ? ` ${msg}` : ''}`,
				icon: '✓',
			};
		}

		return {
			label: `out of sync${msg ? ` ${msg}` : ''}`,
			icon: '!',
		};
	}, [status, msg, frameIndex]);

	const syncingBackground = useMemo(() => {
		const progress = (Math.sin(colorTick / 10) + 1) / 2;
		return getGradientColor(SYNC_GRADIENT, progress);
	}, [colorTick]);

	const backgroundColor =
		status === 'syncing'
			? syncingBackground
			: status === 'synced'
			? theme.secondary
			: status === 'outOfSync'
			? theme.accent2
			: theme.secondary2;

	const textColor = status === 'syncing' ? theme.primary : theme.secondary2;

	// reserve 2 chars for icon (space + icon)
	const content = useMemo(() => {
		const maxLabelWidth = WIDTH - 2;
		const trimmedLabel =
			label.length > maxLabelWidth
				? label.slice(0, maxLabelWidth)
				: label.padEnd(maxLabelWidth, ' ');

		return ` ${trimmedLabel} ${icon} `;
	}, [label, icon]);

	return (
		<Box paddingRight={1} paddingLeft={1}>
			<Text backgroundColor={backgroundColor} color={textColor}>
				{content}
			</Text>
		</Box>
	);
};
