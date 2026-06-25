import {Box, Text} from 'ink';
import React from 'react';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';

type Props = {
	width: number;
};

// Full-width "scrubber" rendered in place of the command line during a replay.
// Reads like a movie player's timeline: a fill bar and the percentage played.
// Colors are intentionally muted so the bar frames the board without stealing
// focus from the content that is actually evolving above it.
export const ReplayProgressBar: React.FC<Props> = ({width}) => {
	const {replay} = useAppState();

	if (!replay) return null;

	// Track elapsed playback time, not events applied, so the bar advances
	// smoothly even while fast-forwarding through quiet stretches.
	const ratio = Math.min(1, Math.max(0, replay.progress));
	const pct = Math.round(ratio * 100);

	const pctLabel = `${String(pct).padStart(3)}%`;

	// Reserve room for the border, horizontal padding, play icon, the percentage,
	// and the gaps between the row's items; the fill bar flexes to fill whatever
	// horizontal space is left.
	const reserved = pctLabel.length + 8;
	const barWidth = Math.max(4, width - reserved);
	const filled = Math.min(barWidth, Math.round(ratio * barWidth));

	// Just the fill — no playhead marker. The filled portion sits at secondary2,
	// the remaining track is the same glyph dimmed, so the bar reads as a quiet
	// frame rather than a bright focal point.
	const filledBar = '█'.repeat(filled);
	const unfilledBar = '░'.repeat(barWidth - filled);

	return (
		<Box
			width={width}
			borderStyle="round"
			borderColor={theme.secondary}
			paddingX={1}
			columnGap={1}
		>
			<Text color={theme.secondary2}>▶</Text>
			<Text>
				<Text color={theme.secondary}>{filledBar}</Text>
				<Text color={theme.secondary} dimColor>
					{unfilledBar}
				</Text>
			</Text>
			<Text color={theme.secondary2}>{pctLabel}</Text>
		</Box>
	);
};
