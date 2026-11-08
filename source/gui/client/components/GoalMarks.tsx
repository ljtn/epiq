// A goal's marks: a short bar in its colour before its name, on a card as on
// the strip, so the two read as one. Its progress is a stroke along the strip
// pill's foot.

import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

/** A short upright bar in the goal's colour. */
export const GoalMark = ({color}: {color: string}) => (
	<span
		data-testid="goal-mark"
		aria-hidden
		style={{
			width: 3,
			height: 11,
			borderRadius: 1.5,
			background: color,
			flexShrink: 0,
		}}
	/>
);

/** What pressing a goal's filter does, on a pill or a card. */
export const goalFilterTitle = (narrowed: boolean): string =>
	narrowed ? 'Show every ticket again' : 'Show only this goal';

export const GoalLabel = ({
	color,
	label,
	height,
	testId,
	pressed = false,
	onPress,
	pressTitle,
}: {
	color: string;
	label: string;
	// The line it leads, which it stands as tall as.
	height: number;
	testId: string;
	// Held on, as a narrowed tag chip is.
	pressed?: boolean;
	onPress?: () => void;
	pressTitle?: string;
}) => {
	const style: React.CSSProperties = {
		maxWidth: '45%',
		flexShrink: 0,
		height,
		padding: '0 7px',
		borderRadius: 4,
		fontSize: 11,
		display: 'inline-flex',
		alignItems: 'center',
		gap: 5,
		boxSizing: 'border-box',
		minWidth: 0,
		lineHeight: 1,
		fontFamily: 'inherit',
		color: GUI_THEME.secondary,
		background: GUI_THEME.well,
		// Held on, the whole frame takes the goal's colour.
		border: `1px solid ${pressed ? color : GUI_THEME.line}`,
	};
	const content = (
		<>
			<GoalMark color={color} />
			<span
				style={{
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{label}
			</span>
		</>
	);

	if (!onPress) {
		return (
			<span data-testid={testId} title={label} style={style}>
				{content}
			</span>
		);
	}

	return (
		<button
			type="button"
			data-testid={testId}
			aria-pressed={pressed}
			title={pressTitle ?? label}
			// Stopped here, or a click on a card would also select it.
			onClick={event => {
				event.stopPropagation();
				onPress();
			}}
			style={{...style, cursor: 'pointer'}}
		>
			{content}
		</button>
	);
};

// How far along a goal is: its colour over a faint track, so a short stroke
// reads as a share of the whole.
export const GoalProgressLine = ({
	color,
	share,
	thickness,
	testId,
	style,
}: {
	color: string;
	share: number;
	thickness: number;
	testId?: string;
	style?: React.CSSProperties;
}) => (
	<span
		aria-hidden
		style={{
			display: 'block',
			height: thickness,
			borderRadius: thickness / 2,
			background: GUI_THEME.line,
			pointerEvents: 'none',
			...style,
		}}
	>
		<span
			data-testid={testId}
			style={{
				display: 'block',
				height: '100%',
				width: `${Math.round(share * 100)}%`,
				borderRadius: thickness / 2,
				background: color,
			}}
		/>
	</span>
);
