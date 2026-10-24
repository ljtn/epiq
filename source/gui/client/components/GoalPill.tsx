// The goal a card belongs to, named in its colour at the card's top left;
// on the goal's own card, how far along its tickets are. On a card it is a
// square label in the corner with a short bar of its colour, so it never
// reads as a tag.

import React from 'react';

// A colour's wash: the same hue, faint enough for text in the full colour to
// read on it.
const wash = (color: string) => `${color}2e`;

/** The corner tab's height, which a card makes room for above its title. */
export const GOAL_TAB_HEIGHT = 16;
export const GOAL_TAB_INSET = 4;

export const GoalPill = ({
	color,
	label,
	strong = false,
	testId,
	isolated = false,
	onFilter,
	filterTitle,
	variant = 'pill',
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
	// A card draws it as a square label: in its corner, or on a dense card's
	// bottom line; the panel, as a pill.
	variant?: 'pill' | 'corner' | 'inline';
}) => {
	const filled = strong || isolated;
	const square: React.CSSProperties = {
		maxWidth: '70%',
		boxSizing: 'border-box',
		borderRadius: 0,
		borderWidth: '0 0 0 2px',
		borderStyle: 'solid',
		borderColor: color,
	};
	const shape: React.CSSProperties =
		variant === 'corner'
			? {
					...square,
					position: 'absolute',
					top: GOAL_TAB_INSET,
					left: GOAL_TAB_INSET,
					height: GOAL_TAB_HEIGHT,
					padding: '0 7px',
			  }
			: variant === 'inline'
			? {
					...square,
					maxWidth: '40%',
					flexShrink: 0,
					minWidth: 0,
					padding: '0 6px',
			  }
			: {
					alignSelf: 'flex-start',
					maxWidth: '100%',
					padding: '1px 7px',
					borderRadius: 999,
					borderWidth: 0,
			  };
	const style: React.CSSProperties = {
		...shape,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
		fontFamily: 'inherit',
		fontSize: 10,
		lineHeight:
			variant === 'corner'
				? `${GOAL_TAB_HEIGHT}px`
				: variant === 'inline'
				? '14px'
				: '15px',
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
