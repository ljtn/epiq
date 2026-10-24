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
	isolated = false,
	onFilter,
	filterTitle,
}: {
	color: string;
	label: string;
	// The goal's own card: filled, so it reads as the thing the others
	// point at.
	strong?: boolean;
	testId: string;
	// The board narrowed to this goal: filled, as a held tag chip is.
	isolated?: boolean;
	onFilter?: () => void;
	filterTitle?: string;
}) => {
	const filled = strong || isolated;
	const style: React.CSSProperties = {
		alignSelf: 'flex-start',
		maxWidth: '100%',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		padding: '1px 7px',
		borderRadius: 999,
		borderWidth: 0,
		fontFamily: 'inherit',
		fontSize: 10,
		lineHeight: '15px',
		fontWeight: filled ? 600 : 500,
		color: filled ? '#0b0d12' : color,
		background: filled ? color : wash(color),
	};

	if (!onFilter) {
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
			aria-pressed={isolated}
			title={filterTitle ?? label}
			// Stopped here, or the click would also select the card.
			onClick={event => {
				event.stopPropagation();
				onFilter();
			}}
			style={{...style, cursor: 'pointer'}}
		>
			{label}
		</button>
	);
};

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
