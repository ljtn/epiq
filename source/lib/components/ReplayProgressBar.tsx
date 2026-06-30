import {Box, Text} from 'ink';
import React, {useEffect, useRef, useState} from 'react';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {getGradientHexColor} from '../utils/color.js';

type Props = {
	width: number;
};

// The replay engine only nudges `replay.progress` a handful of times per second
// (once per playback frame), which makes a naive bar jump in visible steps. We
// tween the rendered fill on a faster, local timer to fill in the intermediate
// frames.
const TWEEN_FRAME_MS = 40;

// We glide at a constant velocity matched to the rate the target is actually advancing.
// Measured from the engine's own updates (step size over the time between them),
// smoothed so quantization jitter doesn't wobble the speed.
const PACE_EMA = 0.3;

const LINE_CHAR = '─';
const SUBCELLS = 1;

// Number of discrete color steps the fill gradient is quantized into across the
// bar's width.
const GRADIENT_BANDS = 16;

// Full-width "scrubber" rendered in place of the command line during a replay.
export const ReplayProgressBar: React.FC<Props> = ({width}) => {
	const {replay} = useAppState();

	const isReplaying = replay !== null;

	// Track elapsed playback time, not events applied, so the bar advances
	// smoothly even while fast-forwarding through quiet stretches.
	const target = replay ? Math.min(1, Math.max(0, replay.progress)) : 0;

	// Reserve room for the border, horizontal padding, etc.
	const reserved = 6;
	const barWidth = Math.max(4, width - reserved);
	const totalUnits = barWidth * SUBCELLS;

	// The quantized fill (0..totalUnits) drives the bar.
	const [fillUnits, setFillUnits] = useState(0);
	const targetRef = useRef(target);
	targetRef.current = target;

	// Pace tracking: the value/time of the last engine update (our anchor), plus
	// the measured rate (progress per ms) and step size we glide with between
	// updates.
	const anchorRef = useRef(0);
	const anchorAtRef = useRef(0);
	const lastTargetRef = useRef(0);
	const rateRef = useRef(0);
	const stepRef = useRef(0);

	useEffect(() => {
		if (!isReplaying) {
			anchorRef.current = 0;
			lastTargetRef.current = 0;
			rateRef.current = 0;
			stepRef.current = 0;
			setFillUnits(0);
			return;
		}

		// Anchor the pace measurement to the moment playback (re)starts.
		anchorRef.current = targetRef.current;
		anchorAtRef.current = Date.now();
		lastTargetRef.current = targetRef.current;

		const id = setInterval(() => {
			const now = Date.now();
			const t = targetRef.current;

			// On each real engine update, re-anchor and learn the pace (how big a
			// step and how long it took), smoothed so jitter doesn't wobble the speed.
			if (t !== lastTargetRef.current) {
				const delta = t - lastTargetRef.current;
				const elapsed = now - anchorAtRef.current;

				if (delta < 0) {
					// A fresh replay reset progress to 0: start the pace over.
					rateRef.current = 0;
					stepRef.current = 0;
				} else if (delta > 0 && elapsed > 0) {
					const rate = delta / elapsed;
					rateRef.current =
						rateRef.current === 0
							? rate
							: rateRef.current * (1 - PACE_EMA) + rate * PACE_EMA;
					stepRef.current =
						stepRef.current === 0
							? delta
							: stepRef.current * (1 - PACE_EMA) + delta * PACE_EMA;
				}

				anchorRef.current = t;
				anchorAtRef.current = now;
				lastTargetRef.current = t;
			}

			// Glide on from the anchor at the measured pace, but lead no more than
			// one step ahead so we arrive at the next value just as it lands — a
			// continuous fill with no dart-then-stall — and never past full. Because
			// we travel at the true pace (not a fraction of it), the bar fills the
			// final stretch at the same tempo and reaches 100% on its own.
			const elapsed = now - anchorAtRef.current;
			const lead = Math.min(stepRef.current, rateRef.current * elapsed);
			const next = Math.min(1, anchorRef.current + lead);

			const units = Math.round(next * totalUnits);
			// Returning the same value makes React bail out of the re-render, so the
			// component only repaints when the visible fill actually changes.
			setFillUnits(prevUnits => (prevUnits === units ? prevUnits : units));
		}, TWEEN_FRAME_MS);

		return () => clearInterval(id);
	}, [isReplaying, totalUnits]);

	if (!replay) return null;

	// Sample the shared lavender -> blue -> cyan gradient at a cell's position
	// across the full track, quantized into a handful of bands so neighbors can
	// be merged into runs (a long bar stays a few <Text> spans, not one per cell).
	const cellColor = (index: number): string => {
		const position = barWidth > 1 ? index / (barWidth - 1) : 0;
		const band =
			Math.round(position * (GRADIENT_BANDS - 1)) / (GRADIENT_BANDS - 1);

		return getGradientHexColor(band);
	};

	const filledCells = Math.min(barWidth, Math.floor(fillUnits / SUBCELLS));

	const filledRuns: {text: string; color: string}[] = [];
	for (let i = 0; i < filledCells; i++) {
		const color = cellColor(i);
		const last = filledRuns[filledRuns.length - 1];

		if (last && last.color === color) last.text += LINE_CHAR;
		else filledRuns.push({text: LINE_CHAR, color});
	}

	// The remaining track is the same line glyph dimmed, so the bar reads as a
	// quiet rule rather than a bright focal point.
	const trackBar = LINE_CHAR.repeat(Math.max(0, barWidth - filledCells));

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
				{filledRuns.map((run, i) => (
					<Text key={i} color={run.color}>
						{run.text}
					</Text>
				))}
				<Text color={theme.secondary} dimColor>
					{trackBar}
				</Text>
			</Text>
		</Box>
	);
};
