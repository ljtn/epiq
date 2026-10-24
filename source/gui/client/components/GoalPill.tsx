// The goal a card belongs to, named in its colour at the card's top left;
// on the goal's own card, how far along its tickets are. On a card it is a
// tab let into the corner rather than a pill, so it never reads as a tag.

import React from 'react';

// A colour's wash: the same hue, faint enough for text in the full colour to
// read on it.
const wash = (color: string) => `${color}2e`;

/** The corner tab's height, which a card makes room for above its title. */
export const GOAL_TAB_HEIGHT = 16;

export const GoalPill = ({
	color,
	label,
	strong = false,
	testId,
	isolated = false,
	onFilter,
	filterTitle,
	corner,
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
	// The card's radius, when drawn as the card's corner tab.
	corner?: number;
}) => {
	const filled = strong || isolated;
	const shape: React.CSSProperties =
		corner === undefined
			? {
					alignSelf: 'flex-start',
					maxWidth: '100%',
					padding: '1px 7px',
					borderRadius: 999,
			  }
			: {
					position: 'absolute',
					top: 0,
					left: 0,
					maxWidth: '70%',
					height: GOAL_TAB_HEIGHT,
					boxSizing: 'border-box',
					padding: '0 8px 0 10px',
					borderRadius: `${corner}px 0 6px 0`,
			  };
	const style: React.CSSProperties = {
		...shape,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		borderWidth: 0,
		fontFamily: 'inherit',
		fontSize: 10,
		lineHeight: corner === undefined ? '15px' : `${GOAL_TAB_HEIGHT}px`,
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
			// From under the tab, so the two read as one mark.
			top: GOAL_TAB_HEIGHT + 4,
			bottom: 8,
			width: 2,
			borderRadius: 1,
			background: color,
			pointerEvents: 'none',
		}}
	/>
);
