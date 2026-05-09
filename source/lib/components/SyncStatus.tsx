import chalk from 'chalk';
import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {SyncStatus} from '../model/app-state.model.js';
import {theme} from '../theme/themes.js';

type SyncStatusPillProps = {
	syncStatus: SyncStatus;
	autoSync: boolean;
};

const SYNC_GRADIENT = ['#4c567a', '#9d7cd8', '#7aa2f7', '#7dcfff', '#9d7cd8'];

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

export function SyncStatusPill({syncStatus, autoSync}: SyncStatusPillProps) {
	const [tick, setTick] = useState(0);

	useEffect(() => {
		if (syncStatus.status !== 'syncing') {
			setTick(0);
			return;
		}

		const id = setInterval(() => {
			setTick(prev => prev + 1);
		}, 50);

		return () => clearInterval(id);
	}, [syncStatus.status]);

	const labelByStatus = {
		synced: 'ok',
		failed: 'retry',
		syncing: '...',
		pending: 'wait',
	} satisfies Record<typeof syncStatus.status, string>;

	const colorByStatus = {
		synced: theme.secondary2,
		failed: theme.yellow,
		pending: theme.secondary2,
		syncing:
			getGradientColor(SYNC_GRADIENT, (Math.sin(tick * 0.12) + 1) / 2) ?? '',
	} satisfies Record<typeof syncStatus.status, string>;

	const color = colorByStatus[syncStatus.status];

	return (
		<Box>
			<Text>
				{chalk.hex(theme.secondary2).dim(autoSync ? 'AutoSync: ' : 'Sync: ')}
			</Text>
			<Text>
				{chalk.hex(color)('●') +
					chalk
						.hex(theme.secondary2)
						.dim(` ${labelByStatus[syncStatus.status].padEnd(4)} `)}
			</Text>
		</Box>
	);
}
