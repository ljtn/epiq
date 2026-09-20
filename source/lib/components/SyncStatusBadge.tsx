import {Box, Text} from 'ink';
import {sampleGradient} from '../utils/color.js';
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

		// Local work is committed, so this is not the "!" of a failed sync.
		if (status === 'offline') {
			return {
				label: msg || 'offline',
				icon: '⌁',
			};
		}

		return {
			label: `out of sync${msg ? ` ${msg}` : ''}`,
			icon: '!',
		};
	}, [status, msg, frameIndex]);

	const syncingBackground = useMemo(() => {
		const progress = (Math.sin(colorTick / 10) + 1) / 2;
		return sampleGradient(SYNC_GRADIENT, progress);
	}, [colorTick]);

	const backgroundColor =
		status === 'syncing'
			? syncingBackground
			: status === 'synced'
			? theme.secondary
			: status === 'failed'
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
