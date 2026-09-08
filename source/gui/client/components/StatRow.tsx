import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {
	ROW,
	STAT_CELL,
	STAT_LABEL,
	STAT_NOTE,
	STAT_VALUE,
} from '../lib/issue-stats.style';

// The two marks every stats surface is built from: a figure with its label,
// and a named share in a list. Shared so a ticket's Stats tab and a lane's
// panel read as one thing rather than as two takes on the same idea.

export const Stat = ({
	value,
	label,
	note,
	title,
}: {
	value: string;
	label: string;
	note?: React.ReactNode;
	title?: string;
}) => (
	<div
		style={STAT_CELL}
		title={title}
		// The same lift every hoverable surface in the app takes, so a figure
		// under the pointer separates from the four beside it — and a path in
		// the note below reads as part of that block rather than as loose text.
		onMouseEnter={event => {
			event.currentTarget.style.background = GUI_THEME.hover;
		}}
		onMouseLeave={event => {
			event.currentTarget.style.background = 'transparent';
		}}
	>
		<div style={STAT_VALUE}>{value}</div>
		<div style={STAT_LABEL}>{label}</div>
		{note && <div style={STAT_NOTE}>{note}</div>}
	</div>
);

export const StatRow = ({
	left,
	right,
	dot,
	last = false,
}: {
	left: React.ReactNode;
	right: React.ReactNode;
	dot?: string;
	// The section below draws its own top border, so a rule under the final row
	// is that border twice.
	last?: boolean;
}) => (
	<div style={last ? {...ROW, borderBottom: 'none'} : ROW}>
		<span
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 8,
				color: GUI_THEME.secondary,
				minWidth: 0,
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
			}}
		>
			{dot && (
				// The bar above says which share is which by position; this says
				// it again by name, so the reading never rests on colour alone.
				<span
					aria-hidden
					style={{
						width: 7,
						height: 7,
						borderRadius: 2,
						background: dot,
						flexShrink: 0,
					}}
				/>
			)}
			{left}
		</span>
		<span style={{color: GUI_THEME.primary, flexShrink: 0}}>{right}</span>
	</div>
);
