import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {
	ROW,
	STAT_CAPTION,
	STAT_CELL,
	STAT_CELL_COMPACT,
	STAT_HOVER_BACKGROUND,
	STAT_LABEL,
	STAT_NOTE,
	STAT_VALUE,
	STAT_VALUE_COMPACT,
	statValueSize,
} from '../lib/issue-stats.style';

// The two marks every stats surface is built from: a figure with its label,
// and a named share in a list. Shared so a ticket's Stats tab and a lane's
// panel read as one thing rather than as two takes on the same idea.

export const Stat = ({
	value,
	label,
	note,
	action,
	title,
	size = 'full',
	testId,
}: {
	value: string;
	label: string;
	note?: React.ReactNode;
	// A control beside the label, hung off its end so the label stays centred.
	action?: React.ReactNode;
	title?: string;
	// `full` is the Stats tab's square; `compact` the same figure over its
	// label at a panel's size, where four at full size would be the loudest
	// thing on it.
	size?: 'full' | 'compact';
	testId?: string;
}) => (
	<div
		data-testid={testId}
		style={size === 'compact' ? STAT_CELL_COMPACT : STAT_CELL}
		title={title}
		onMouseEnter={event => {
			event.currentTarget.style.background = STAT_HOVER_BACKGROUND;
		}}
		onMouseLeave={event => {
			event.currentTarget.style.background = STAT_CELL.background as string;
		}}
	>
		<div
			data-testid={testId ? `${testId}-value` : undefined}
			style={{
				...STAT_VALUE,
				...(size === 'compact'
					? STAT_VALUE_COMPACT
					: {fontSize: statValueSize(value)}),
				gridRow: 2,
			}}
		>
			{value}
		</div>
		<div style={STAT_CAPTION}>
			<div style={{...STAT_LABEL, position: 'relative'}}>
				{label}
				{action && (
					<span
						style={{
							position: 'absolute',
							left: '100%',
							top: '50%',
							transform: 'translateY(-50%)',
							marginLeft: 2,
						}}
					>
						{action}
					</span>
				)}
			</div>
			{note && <div style={STAT_NOTE}>{note}</div>}
		</div>
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
