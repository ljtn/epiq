import chalk from 'chalk';
import {sampleGradient} from '../utils/color.js';
import {Box, Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {SyncStatus} from '../model/app-state.model.js';
import {theme} from '../theme/themes.js';

type SyncStatusPillProps = {
	syncStatus: SyncStatus;
	autoSync: boolean;
};

const SYNC_GRADIENT = ['#4c567a', '#9d7cd8', '#7aa2f7', '#7dcfff', '#9d7cd8'];

const SYNC_FRAME_MS = 150;
const SYNC_STEPS = 12;
const SYNC_PHASE_RATE = 0.36;

export function SyncStatusPill({syncStatus, autoSync}: SyncStatusPillProps) {
	// Quantized gradient step (0..SYNC_STEPS-1). Re-rendering only happens when
	// this value actually changes, so a slow terminal isn't repainted on every
	// animation frame.
	const [colorStep, setColorStep] = useState(0);

	useEffect(() => {
		if (syncStatus.status !== 'syncing') {
			setColorStep(0);
			return;
		}

		let phase = 0;
		const id = setInterval(() => {
			phase += 1;
			const progress = (Math.sin(phase * SYNC_PHASE_RATE) + 1) / 2;
			const next = Math.round(progress * (SYNC_STEPS - 1));
			// Returning the same value makes React bail out of the re-render.
			setColorStep(prev => (prev === next ? prev : next));
		}, SYNC_FRAME_MS);

		return () => clearInterval(id);
	}, [syncStatus.status]);

	const labelByStatus = {
		synced: '    ',
		failed: '---',
		offline: 'off',
		syncing: '...',
		pending: 'idle',
	} satisfies Record<typeof syncStatus.status, string>;

	const colorByStatus = {
		synced: theme.secondary2,
		failed: theme.yellow,
		// Not an error state: the local commit is safe, the remote is not there.
		offline: theme.secondary2,
		pending: theme.secondary2,
		syncing: sampleGradient(SYNC_GRADIENT, colorStep / (SYNC_STEPS - 1)) ?? '',
	} satisfies Record<typeof syncStatus.status, string>;

	const color = colorByStatus[syncStatus.status];

	return (
		<Box>
			<Text>
				{chalk.hex(theme.secondary2).dim(autoSync ? 'Sync (auto): ' : 'Sync: ')}
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
