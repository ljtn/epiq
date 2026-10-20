import {BoardThroughputPoint} from '../../../lib/stats/board-overview.model.js';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

// Tickets closed per week. One series, so no legend: the section heading says
// what is plotted. Only the latest week is labelled; each bar names its own
// week and count on hover.

const HEIGHT = 56;
const GAP = 2;

const weekLabel = (t: number) =>
	new Date(t).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});

export const ThroughputBars = ({points}: {points: BoardThroughputPoint[]}) => {
	const peak = Math.max(1, ...points.map(point => point.closed));
	const latest = points.at(-1);

	return (
		<div data-testid="board-throughput" style={{marginTop: 12}}>
			<div
				style={{
					display: 'flex',
					alignItems: 'flex-end',
					gap: GAP,
					height: HEIGHT,
					borderBottom: `1px solid ${GUI_THEME.line}`,
				}}
			>
				{points.map(point => (
					// The hit area is the full column, not the bar: a quiet week is
					// still worth pointing at.
					<div
						key={point.t}
						title={`Week of ${weekLabel(point.t)}: ${point.closed} closed`}
						style={{
							flex: 1,
							height: '100%',
							display: 'flex',
							alignItems: 'flex-end',
						}}
					>
						<div
							style={{
								width: '100%',
								height: `${(point.closed / peak) * 100}%`,
								minHeight: point.closed > 0 ? 2 : 0,
								background: GUI_THEME.accent,
								borderRadius: '4px 4px 0 0',
							}}
						/>
					</div>
				))}
			</div>

			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					marginTop: 4,
					color: GUI_THEME.dim,
					fontSize: TEXT.label,
				}}
			>
				<span>{points[0] ? weekLabel(points[0].t) : ''}</span>
				<span>
					This week
					{latest && (
						<span style={{color: GUI_THEME.primary}}> · {latest.closed}</span>
					)}
				</span>
			</div>
		</div>
	);
};
