// A card's goal, named in its colour in the goal dropdown's dark frame, so
// it never reads as a tag. A card in a goal also carries its colour down its
// left edge, and a goal's progress is the same stroke laid flat.

import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const GoalLabel = ({
	color,
	label,
	height,
	testId,
	pressed = false,
	disabled = false,
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
	disabled?: boolean;
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
		boxSizing: 'border-box',
		minWidth: 0,
		lineHeight: 1,
		fontFamily: 'inherit',
		// Its colour carries the name, so a lane's goals tell apart at a glance.
		color,
		background: GUI_THEME.well,
		// Held on, the frame takes the goal's colour.
		border: `1px solid ${pressed ? color : GUI_THEME.line}`,
	};
	const content = (
		<span
			style={{
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
			}}
		>
			{label}
		</span>
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
			disabled={disabled}
			title={pressTitle ?? label}
			// Stopped here, or a click on a card would also select it.
			onClick={event => {
				event.stopPropagation();
				onPress();
			}}
			style={{...style, cursor: disabled ? 'default' : 'pointer'}}
		>
			{content}
		</button>
	);
};

// A straight bar inside the card's left edge, clear of its rounded corners.
export const GoalStripe = ({color, inset}: {color: string; inset: number}) => (
	<span
		data-testid="ticket-goal-stripe"
		aria-hidden
		style={{
			position: 'absolute',
			left: 4,
			top: inset,
			bottom: inset,
			width: 2,
			borderRadius: 1,
			background: color,
			pointerEvents: 'none',
		}}
	/>
);

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
