import React, {useState} from 'react';
import {Checkbox} from './Checkbox';
import {StatRow} from './StatRow';
import {GUI_THEME} from '../lib/gui-theme';

// The Stats tab's two bars, its only colour: 4px, segments split by a 2px gap.
// Rows below name every segment, so identity is never colour alone.

const BAR_HEIGHT = 4;
const SEGMENT_GAP = 2;

export type BarSegment = {
	label: string;
	value: number;
	color: string;
};

/** Parts of a whole: one bar, one segment per part, widths summing to 100%. */
export const StackedBar = ({segments}: {segments: BarSegment[]}) => {
	const total = segments.reduce((sum, segment) => sum + segment.value, 0);
	if (total <= 0) return null;

	return (
		<div
			style={{
				display: 'flex',
				gap: SEGMENT_GAP,
				height: BAR_HEIGHT,
				borderRadius: BAR_HEIGHT / 2,
				overflow: 'hidden',
				marginTop: 12,
			}}
		>
			{segments.map(segment => (
				<div
					key={segment.label}
					title={`${segment.label} — ${Math.round(
						(100 * segment.value) / total,
					)}%`}
					style={{
						flexGrow: segment.value,
						flexBasis: 0,
						minWidth: 2,
						background: segment.color,
					}}
				/>
			))}
		</div>
	);
};

/**
 * A share against its whole, with an optional comparison mark cut through the
 * bar in the panel colour.
 */
export const ProportionBar = ({
	value,
	color,
	restColor = GUI_THEME.tertiary,
	label,
	reference,
	referenceLabel,
}: {
	value: number;
	color: string;
	restColor?: string;
	label: string;
	reference?: number | null;
	referenceLabel?: string;
}) => (
	<div
		title={label}
		style={{
			position: 'relative',
			height: BAR_HEIGHT,
			borderRadius: BAR_HEIGHT / 2,
			background: restColor,
			overflow: 'hidden',
			marginTop: 12,
		}}
	>
		<div
			style={{
				width: `${Math.min(100, Math.max(0, value * 100))}%`,
				height: '100%',
				background: color,
				borderRadius: BAR_HEIGHT / 2,
			}}
		/>

		{typeof reference === 'number' && (
			<div
				title={referenceLabel}
				style={{
					position: 'absolute',
					top: 0,
					bottom: 0,
					left: `calc(${Math.min(100, Math.max(0, reference * 100))}% - 1px)`,
					width: 2,
					background: GUI_THEME.panel,
				}}
			/>
		)}
	</div>
);

export type BreakdownItem = {
	id: string;
	label: string;
	value: number;
	color: string;
	// The part's own amount, read beside its name: a count, a duration.
	amount: string;
};

/**
 * A stacked bar over a checkbox legend; unticking a part removes it from the
 * bar and the shares. Callers remount it by `key` for a new subject.
 */
export const Breakdown = ({
	items,
	initiallyExcluded = [],
	testId,
}: {
	items: BreakdownItem[];
	initiallyExcluded?: readonly string[];
	testId?: string;
}) => {
	const [excluded, setExcluded] =
		useState<readonly string[]>(initiallyExcluded);
	const included = items.filter(item => !excluded.includes(item.id));
	const total = included.reduce((sum, item) => sum + item.value, 0);

	return (
		<>
			{/* Nothing ticked: the bar's own track, muted, so the rows below stay
			    where they were. */}
			<StackedBar
				segments={
					total > 0
						? included
						: [{label: 'Nothing ticked', value: 1, color: GUI_THEME.line}]
				}
			/>

			<div style={{marginTop: 8}}>
				{items.map((item, index) => {
					const on = !excluded.includes(item.id);

					return (
						<StatRow
							key={item.id}
							left={
								<Checkbox
									testId={testId && `${testId}-${item.id}`}
									label={`${item.label} (${item.amount})`}
									checked={on}
									activeColor={item.color}
									onChange={() =>
										setExcluded(
											on
												? [...excluded, item.id]
												: excluded.filter(id => id !== item.id),
										)
									}
								/>
							}
							// One element either way, so a row keeps its height.
							right={
								<span style={{color: on ? undefined : GUI_THEME.dim}}>
									{on && total > 0
										? `${Math.round((100 * item.value) / total)}%`
										: '–'}
								</span>
							}
							last={index === items.length - 1}
						/>
					);
				})}
			</div>
		</>
	);
};
