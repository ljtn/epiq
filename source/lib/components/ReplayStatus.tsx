import {Box, Text} from 'ink';
import React from 'react';
import {formatDateTime} from '../utils/date.utils.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';

// Slim topbar marker shown while a `:replay <when>` replay is running: a
// blinking-style pill plus the date currently being traversed and an edit
// counter. The full scrubber lives at the bottom (see ReplayProgressBar) so the
// topbar stays calm and cinematic.
export function ReplayStatus() {
	const {replay} = useAppState();

	if (!replay) return null;

	const {appliedCount, totalCount, currentTime} = replay;

	return (
		<Box paddingRight={2} columnGap={1} justifyContent="flex-end">
			<Text backgroundColor={theme.accent} color={theme.secondary}>
				{' ▶ REPLAY '}
			</Text>
			<Text color={theme.secondary2}>
				{formatDateTime(new Date(currentTime))}
			</Text>
			<Text color={theme.accent}>{`${appliedCount}/${totalCount} edits`}</Text>
		</Box>
	);
}
