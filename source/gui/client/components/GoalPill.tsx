// The goal a card belongs to, named in its colour at the card's top left;
// on the goal's own card, how far along its tickets are.

import React from 'react';

// A colour's wash: the same hue, faint enough for text in the full colour to
// read on it.
const wash = (color: string) => `${color}2e`;

export const GoalPill = ({
	color,
	label,
	strong = false,
	testId,
}: {
	color: string;
	label: string;
	// The goal's own card: filled, so it reads as the thing the others
	// point at.
	strong?: boolean;
	testId: string;
}) => (
	<span
		data-testid={testId}
		title={label}
		style={{
			alignSelf: 'flex-start',
			maxWidth: '100%',
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			whiteSpace: 'nowrap',
			padding: '1px 7px',
			borderRadius: 999,
			fontSize: 10,
			lineHeight: '15px',
			fontWeight: strong ? 600 : 500,
			color: strong ? '#0b0d12' : color,
			background: strong ? color : wash(color),
		}}
	>
		{label}
	</span>
);

/** A straight bar inside the card's left edge, clear of its rounded corners. */
export const GoalStripe = ({color}: {color: string}) => (
	<span
		data-testid="ticket-goal-stripe"
		aria-hidden
		style={{
			position: 'absolute',
			left: 4,
			top: 8,
			bottom: 8,
			width: 2,
			borderRadius: 1,
			background: color,
			pointerEvents: 'none',
		}}
	/>
);
