// The goal a card belongs to, named in its colour at the card's top left;
// on the goal's own card, how far along its tickets are. On a card it is a
// square label in the corner with a short bar of its colour, so it never
// reads as a tag.

import React from 'react';
import {GoalTabMetrics} from '../lib/card-density';

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
	tab,
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
	// A card's square label: in its corner where the card has the room, else
	// leading the line under its title. Without either, the panel's pill.
	tab?: GoalTabMetrics | 'inline';
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
		tab === 'inline'
			? {...square, maxWidth: '45%', flexShrink: 0, padding: '0 6px'}
			: tab
			? {
					...square,
					position: 'absolute',
					top: tab.top,
					left: tab.left,
					height: tab.height,
					padding: '0 7px',
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
		lineHeight: tab === 'inline' ? '12px' : tab ? `${tab.height}px` : '15px',
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
