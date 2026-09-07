import {GUI_THEME} from '../lib/gui-theme';
import {SERIES_REST} from '../lib/issue-stats.style';

// The two bars the Stats tab draws, and the only colour on it.
//
// Both are the same 8px mark: thin, rounded at the ends of the whole bar and
// square where segments meet, with a 2px gap in the panel colour doing the
// separating rather than a stroke. Neither carries a legend of its own — the
// rows underneath name every segment and repeat its colour, so identity is
// never colour alone.

const BAR_HEIGHT = 8;
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
 * One share against its track, with an optional mark where a comparison sits —
 * the repository's own figure, in the case this exists for. A second colour
 * would say "two things"; there is one thing here, and a reference line.
 */
export const ProportionBar = ({
	value,
	color,
	label,
	reference,
	referenceLabel,
}: {
	value: number;
	color: string;
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
			background: GUI_THEME.tertiary,
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
					// The 2px gap rule again: the marker is a slot cut in the bar,
					// not a line drawn over it.
					left: `calc(${Math.min(100, Math.max(0, reference * 100))}% - 1px)`,
					width: 2,
					background: SERIES_REST,
				}}
			/>
		)}
	</div>
);
