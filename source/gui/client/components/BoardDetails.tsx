import {descriptionLimitOf} from '../../../lib/utils/text.limits.js';
import {AsideDock} from '../lib/aside-dock';
import {GuiBoard} from '../lib/gui-state.model';
import {useEditDraft} from '../lib/ticket-drafts';
import {Aside} from './Aside';
import {DescriptionField} from './DescriptionField';
import {DetailsHeader} from './NodeDetails';
import {Empty} from './FormPrimitives';
import {Section} from './Section';
import {Stat} from './StatRow';
import {ThroughputBars} from './ThroughputBars';
import {BoardOverviewState} from '../lib/use-board-overview';
import {formatDuration} from '../lib/gui-format.helper';
import {seriesColor, statGrid} from '../lib/issue-stats.style';
import {Breakdown} from './StatBars';

export const BoardDetails = ({
	dock,
	board,
	overview: state,
	live,
	onSaveDescription,
	onClose,
}: {
	dock: AsideDock;
	board: GuiBoard;
	overview: BoardOverviewState | null;
	// The board is showing the present. Replayed, it shows its description as
	// it was then, read-only, and none of the figures measured against now.
	live: boolean;
	onSaveDescription: (description: string) => void;
	onClose: () => void;
}) => {
	const overview = state?.overview ?? null;
	const laneColor = (laneId: string) =>
		seriesColor(
			Math.max(
				0,
				board.swimlanes.findIndex(lane => lane.id === laneId),
			),
		);

	const descriptionEdit = useEditDraft(
		board.id,
		'description',
		board.description ?? '',
	);

	return (
		<Aside dock={dock}>
			<DetailsHeader
				testId="board-details"
				kind="Board"
				title={board.title}
				onClose={onClose}
			/>

			<DescriptionField
				draft={descriptionEdit}
				current={board.description ?? ''}
				readonly={board.readonly}
				maxLength={descriptionLimitOf('board')}
				onSave={onSaveDescription}
				collapseKey={board.id}
				testId="board-description"
				placeholder="Conventions for this board, in markdown"
			/>

			{live && state?.loading && <Empty>Reading the board…</Empty>}
			{live && state?.error && <Empty>{state.error}</Empty>}

			{live && overview && (
				<>
					<Section title={`Flow, ${overview.throughput.length} weeks`}>
						<div style={statGrid(4, 2)}>
							<Stat
								size="compact"
								value={String(overview.filed)}
								label="Filed"
							/>
							<Stat
								size="compact"
								value={String(overview.closed)}
								label="Closed"
							/>
							<Stat
								size="compact"
								value={
									overview.medianLeadTimeMs === null
										? '–'
										: formatDuration(overview.medianLeadTimeMs) || '0s'
								}
								label="Median lead time"
								title="From filed to closed"
							/>
							<Stat
								size="compact"
								value={
									overview.sentBackShare === null
										? '–'
										: `${Math.round(overview.sentBackShare * 100)}%`
								}
								label="Sent back"
								title="Closed tickets that went back to an earlier lane at least once"
							/>
						</div>
						{overview.throughput.some(week => week.closed > 0) && (
							<ThroughputBars points={overview.throughput} />
						)}
					</Section>

					<Section title="Time per lane">
						{overview.laneTime.length === 0 ? (
							<Empty>Nothing closed in these weeks</Empty>
						) : (
							// Coloured by the lane's place on the board, so a lane keeps its
							// colour when another is left out. The board's last lane is
							// where finished work waits to be released, time the board is
							// not spending: left out unless ticked.
							<Breakdown
								key={board.id}
								testId="board-lane-time-toggle"
								items={overview.laneTime.map(lane => ({
									id: lane.laneId,
									label: lane.title,
									value: lane.meanMs,
									color: laneColor(lane.laneId),
									amount: formatDuration(lane.meanMs) || '0s',
								}))}
								initiallyExcluded={
									board.swimlanes.at(-1) ? [board.swimlanes.at(-1)!.id] : []
								}
							/>
						)}
					</Section>
				</>
			)}
		</Aside>
	);
};
