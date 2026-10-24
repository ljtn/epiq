// A goal, named in its colour on a square label with a short bar of it, so it
// never reads as a tag: in a card's corner, leading a dense card's bottom
// line, or in the ticket panel. On the goal's own ticket it is filled.

import React from 'react';
import {GoalTabMetrics} from '../lib/card-density';

// A colour's wash: the same hue, faint enough for text in the full colour to
// read on it.
const wash = (color: string) => `${color}2e`;

type Place =
	| {kind: 'corner'; tab: GoalTabMetrics}
	| {kind: 'line'}
	| {kind: 'panel'};

const placeStyle = (place: Place): React.CSSProperties => {
	if (place.kind === 'corner') {
		return {
			position: 'absolute',
			top: place.tab.top,
			left: place.tab.left,
			maxWidth: '70%',
			height: place.tab.height,
			padding: '0 7px',
			fontSize: 10,
			lineHeight: `${place.tab.height}px`,
		};
	}

	if (place.kind === 'line') {
		return {
			maxWidth: '45%',
			flexShrink: 0,
			padding: '0 6px',
			fontSize: 10,
			lineHeight: '12px',
		};
	}

	// Bigger, as the panel's text is.
	return {
		alignSelf: 'flex-start',
		maxWidth: '100%',
		padding: '3px 10px',
		fontSize: 12,
		lineHeight: '18px',
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
	// The goal's own ticket: filled, so it reads as the thing the others
	// point at.
	strong?: boolean;
	// Held on, as a narrowed tag chip is: filled too.
	pressed?: boolean;
	disabled?: boolean;
	onPress?: () => void;
	pressTitle?: string;
}) => {
	const filled = strong || pressed;
	const style: React.CSSProperties = {
		...placeStyle(place),
		boxSizing: 'border-box',
		borderRadius: 0,
		borderWidth: `0 0 0 ${place.kind === 'panel' ? 3 : 2}px`,
		borderStyle: 'solid',
		borderColor: color,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		fontFamily: 'inherit',
		fontWeight: filled ? 600 : 500,
		color: filled ? '#0b0d12' : color,
		background: filled ? color : wash(color),
	};

	if (!onPress) {
		return (
			<span data-testid={testId} title={label} style={style}>
				{label}
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
			{label}
		</button>
	);
};
