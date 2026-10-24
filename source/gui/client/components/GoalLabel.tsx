// A goal, named in its colour beside a bar of it in the goal dropdown's dark
// frame, so it never reads as a tag and looks the same on a card as in the
// ticket panel.

import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

type Place = {kind: 'line'; height: number} | {kind: 'panel'};

const placeStyle = (place: Place): React.CSSProperties => {
	if (place.kind === 'line') {
		return {
			maxWidth: '45%',
			flexShrink: 0,
			height: place.height,
			gap: 6,
			padding: '0 7px 0 5px',
			borderRadius: 4,
			fontSize: 11,
		};
	}

	// Bigger, as the panel's text is.
	return {
		alignSelf: 'flex-start',
		maxWidth: '100%',
		gap: 8,
		padding: '5px 10px',
		borderRadius: 8,
		fontSize: 12,
	};
};

export const GoalLabel = ({
	color,
	label,
	place,
	testId,
	strong = false,
	pressed = false,
	disabled = false,
	onPress,
	pressTitle,
}: {
	color: string;
	label: string;
	place: Place;
	testId: string;
	// The goal's own ticket: bold, as the thing the others point at.
	strong?: boolean;
	// Held on, as a narrowed tag chip is.
	pressed?: boolean;
	disabled?: boolean;
	onPress?: () => void;
	pressTitle?: string;
}) => {
	const style: React.CSSProperties = {
		...placeStyle(place),
		display: 'inline-flex',
		alignItems: 'center',
		boxSizing: 'border-box',
		minWidth: 0,
		lineHeight: 1,
		fontFamily: 'inherit',
		fontWeight: strong ? 600 : 400,
		// Its colour carries the name, so a lane's goals tell apart at a glance.
		color,
		background: GUI_THEME.well,
		// Held on, the frame takes the goal's colour.
		border: `1px solid ${pressed ? color : GUI_THEME.line}`,
	};
	const content = (
		<>
			<span
				aria-hidden
				style={{
					width: place.kind === 'panel' ? 3 : 2,
					height: place.kind === 'panel' ? 14 : '60%',
					flexShrink: 0,
					background: color,
				}}
			/>
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
