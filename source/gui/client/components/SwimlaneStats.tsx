import {LaneFlow} from '../../../lib/stats/swimlane-stats.model.js';
import {AsideDock} from '../lib/aside-dock';
import {GuiSwimlane} from '../lib/gui-state.model';
import {formatAbsolute, formatDuration} from '../lib/gui-format.helper';
import {GUI_THEME} from '../lib/gui-theme';
import {laneDwell} from '../lib/lane-dwell';
import {
	percent,
	plural,
	ROW,
	seriesColor,
	statGrid,
} from '../lib/issue-stats.style';
import {SwimlaneStatsState} from '../lib/use-swimlane-stats';
import {Aside} from './Aside';
import {Button} from './Button';
import {Empty} from './FormPrimitives';
import {DiffStat} from './DiffStat';
import {StackedBar} from './StatBars';
import {Stat, StatRow} from './StatRow';
import {StayTrend} from './StayTrend';
import {Section} from './Section';

// What a column says about itself: how long things sit in it, what feeds it,
// where they go afterwards, and what the code standing in it comes to.
//
// The two flow lists are the point. A lane in isolation is a number; a lane
// that takes most of its work from Ongoing and sends nearly all of it to Done
// is a description of how the board actually runs — and the exceptions in
// those lists are where it does not.

const CODE_TONE = GUI_THEME.green;
const BOARD_TONE = GUI_THEME.accent;

const FlowList = ({flows, empty}: {flows: LaneFlow[]; empty: string}) => {
	if (flows.length === 0) return <Empty>{empty}</Empty>;

	return (
		<>
			{/* The same bar-then-rows the Stats tab draws its languages with: the
			    split is a shape before it is a list of percentages, and the dots
			    below repeat the colours so identity is never colour alone. */}
			<StackedBar
				segments={flows.map((flow, index) => ({
					label: flow.title,
					value: flow.count,
					color: seriesColor(index),
				}))}
			/>

			<div style={{marginTop: 12}}>
				{flows.map((flow, index) => (
					<StatRow
						key={flow.laneId ?? 'filed'}
						dot={seriesColor(index)}
						left={flow.title}
						last={index === flows.length - 1}
						right={
							<>
								{percent(flow.share)}
								<span style={{color: GUI_THEME.dim}}> · {flow.count}</span>
							</>
						}
					/>
				))}
			</div>
		</>
	);
};

export const SwimlaneStats = ({
	dock,
	swimlane,
	state,
	onClose,
}: {
	dock: AsideDock;
	swimlane: GuiSwimlane;
	state: SwimlaneStatsState | null;
	onClose: () => void;
}) => {
	// The same reading the board's own cards are drawn from, so a lane whose
	// header said one thing cannot say another here.
	const dwell = laneDwell(swimlane.issues, Date.now());
	const stats = state?.stats ?? null;

	return (
		<Aside dock={dock}>
			<div
				data-testid="swimlane-stats"
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 8,
					marginBottom: 12,
				}}
			>
				<div
					style={{
						fontSize: 13,
						fontWeight: 600,
						color: GUI_THEME.primary,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						minWidth: 0,
					}}
				>
					{swimlane.title}
				</div>

				<Button variant="ghost" onClick={onClose} title="Close">
					×
				</Button>
			</div>

			<Section title="Time in this lane" tone={BOARD_TONE} first>
				{dwell ? (
					<div style={statGrid(true)}>
						<Stat
							value={formatDuration(dwell.median) || '0s'}
							label="median stay"
						/>
						<Stat
							value={formatDuration(dwell.max) || '0s'}
							label="longest stay"
						/>
						<Stat
							value={formatDuration(dwell.mean) || '0s'}
							label="average stay"
						/>
						{stats && (
							<Stat
								value={formatDuration(Date.now() - stats.createdAt) || '0s'}
								label="lane age"
								title={`Opened ${formatAbsolute(stats.createdAt)}`}
							/>
						)}
					</div>
				) : (
					<Empty>Nothing is waiting here</Empty>
				)}

				{stats && <StayTrend points={stats.stayTrend} />}
			</Section>

			<Section title="Code standing here" tone={CODE_TONE}>
				{stats && stats.code.commits === 0 ? (
					<Empty>No commits on the tickets in this lane</Empty>
				) : (
					stats && (
						// The diff wears the same pill it wears on a commit row and a
						// ticket's Code tab — a figure the reader already knows how to
						// read, rather than two large numbers that have to say "added"
						// and "removed" to mean anything.
						<div
							style={{
								...ROW,
								borderBottom: 'none',
								marginTop: 12,
								alignItems: 'center',
							}}
						>
							{/* Shrinks first: the pill is the point of the row, and this
							    panel is narrow enough for the two to collide. */}
							<span
								style={{
									color: GUI_THEME.primary,
									minWidth: 0,
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
								}}
							>
								{plural(stats.code.commits, 'commit')} ·{' '}
								{plural(stats.code.tickets, 'ticket')}
							</span>

							<DiffStat
								insertions={stats.code.insertions}
								deletions={stats.code.deletions}
							/>
						</div>
					)
				)}
			</Section>

			<Section title="Usually arrives from" tone={BOARD_TONE}>
				{state?.loading && <Empty>Reading the board…</Empty>}
				{state?.error && <Empty>{state.error}</Empty>}
				{stats && (
					<FlowList
						flows={stats.arrivesFrom}
						empty="Nothing has ever been here"
					/>
				)}
			</Section>

			<Section title="Usually moves on to" tone={BOARD_TONE}>
				{stats && (
					<FlowList
						flows={stats.movesOnTo}
						empty="Nothing has left this lane yet"
					/>
				)}
			</Section>
		</Aside>
	);
};
