import {LaneFlow} from '../../../lib/stats/swimlane-stats.model.js';
import {AsideDock} from '../lib/aside-dock';
import type {LaneRule} from '../../../lib/model/lane-rule.model.js';
import {GuiSwimlane} from '../lib/gui-state.model';
import {formatAbsolute, formatDuration, plural} from '../lib/gui-format.helper';
import {GUI_THEME} from '../lib/gui-theme';
import {laneDwell} from '../lib/lane-dwell';
import {ROW, seriesColor, statGrid} from '../lib/issue-stats.style';
import {SwimlaneStatsState} from '../lib/use-swimlane-stats';
import {Aside} from './Aside';
import {Button} from './Button';
import {Checkbox} from './Checkbox';
import {Empty} from './FormPrimitives';
import {DiffStat} from './DiffStat';
import {Breakdown} from './StatBars';
import {Stat} from './StatRow';
import {StayTrend} from './StayTrend';
import {DetailsHeader} from './NodeDetails';
import {Section} from './Section';
import {Tabs} from './Tabs';
import {DescriptionField} from './DescriptionField';
import {useEditDraft} from '../lib/ticket-drafts';
import {descriptionLimitOf} from '../../../lib/utils/text.limits.js';

// A lane's panel. Overview: name, conventions, rules, actions. Stats: stay,
// where work comes from and goes, and its code.

const FlowList = ({
	laneId,
	flows,
	empty,
	testId,
}: {
	laneId: string;
	flows: LaneFlow[];
	empty: string;
	testId: string;
}) => {
	if (flows.length === 0) return <Empty>{empty}</Empty>;

	return (
		// The same bar-then-rows as the Stats tab's languages.
		<Breakdown
			key={laneId}
			testId={testId}
			items={flows.map((flow, index) => ({
				id: flow.laneId ?? 'filed',
				label: flow.title,
				value: flow.count,
				color: seriesColor(index),
				amount: String(flow.count),
			}))}
		/>
	);
};

export type SwimlaneDetailsTab = 'overview' | 'stats';

export const SwimlaneDetails = ({
	dock,
	swimlane,
	tab,
	onChangeTab,
	state,
	live,
	onRename,
	onSaveDescription,
	onSetRule,
	onDelete,
	onClose,
}: {
	dock: AsideDock;
	swimlane: GuiSwimlane;
	tab: SwimlaneDetailsTab;
	onChangeTab: (tab: SwimlaneDetailsTab) => void;
	state: SwimlaneStatsState | null;
	// The board is showing the present. Replayed, the lane reads as it was
	// then: read-only, and none of the figures measured against now.
	live: boolean;
	onRename: (title: string) => void;
	onSaveDescription: (description: string) => void;
	onSetRule: (rule: LaneRule, on: boolean) => void;
	onDelete: () => void;
	onClose: () => void;
}) => {
	const writable = !swimlane.readonly && live;
	const marksDone = swimlane.rules?.includes('done') ?? false;
	const descriptionEdit = useEditDraft(
		swimlane.id,
		'description',
		swimlane.description ?? '',
	);
	// The same reading the board's own cards are drawn from, so a lane whose
	// header said one thing cannot say another here.
	const dwell = laneDwell(swimlane.issues, Date.now());
	const stats = state?.stats ?? null;

	return (
		<Aside dock={dock}>
			<DetailsHeader
				testId="swimlane-details"
				kind="Swimlane"
				title={swimlane.title}
				{...(writable && {rename: {nodeId: swimlane.id, onSave: onRename}})}
				onClose={onClose}
			/>

			<Tabs
				tabs={[
					{id: 'overview', label: 'Overview'},
					{id: 'stats', label: 'Stats'},
				]}
				activeTab={tab}
				onChange={onChangeTab}
			/>

			{tab === 'overview' && (
				<>
					<DescriptionField
						draft={descriptionEdit}
						current={swimlane.description ?? ''}
						readonly={!writable}
						maxLength={descriptionLimitOf('swimlane')}
						onSave={onSaveDescription}
						collapseKey={swimlane.id}
						testId="swimlane-description"
						placeholder="Conventions for this lane, in markdown"
					/>

					<Section title="Rules">
						<div style={{marginTop: 10}}>
							<Checkbox
								testId="swimlane-rule-done"
								label="Tickets here count as done"
								checked={marksDone || swimlane.doneByName}
								disabled={!writable || swimlane.doneByName}
								{...(swimlane.doneByName && {
									title: 'A lane called Done always counts',
								})}
								onChange={on => onSetRule('done', on)}
							/>
						</div>
					</Section>

					{writable && (
						<Section
							title="Actions"
							action={
								<Button testId="swimlane-delete" onClick={onDelete}>
									Delete swimlane
								</Button>
							}
						>
							{''}
						</Section>
					)}
				</>
			)}

			{tab === 'stats' && !live && (
				<Empty>
					Figures are measured against now; return to the present to read them
				</Empty>
			)}

			{tab === 'stats' && live && (
				<>
					<Section title="Time in this lane">
						{dwell ? (
							<div style={statGrid(4, 2)}>
								<Stat
									value={formatDuration(dwell.median) || '0s'}
									label="Median stay"
								/>
								<Stat
									value={formatDuration(dwell.max) || '0s'}
									label="Longest stay"
								/>
								<Stat
									value={formatDuration(dwell.mean) || '0s'}
									label="Average stay"
								/>
								{stats && (
									<Stat
										value={formatDuration(Date.now() - stats.createdAt) || '0s'}
										label="Lane age"
										title={`Opened ${formatAbsolute(stats.createdAt)}`}
									/>
								)}
							</div>
						) : (
							<Empty>Nothing is waiting here</Empty>
						)}

						{stats && <StayTrend points={stats.stayTrend} />}
					</Section>

					<Section title="Code standing here">
						{stats && stats.code.commits === 0 ? (
							<Empty>No commits on the tickets in this lane</Empty>
						) : (
							stats && (
								// The same diff pill as a commit row.
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

					<Section title="Usually arrives from">
						{state?.loading && <Empty>Reading the board…</Empty>}
						{state?.error && <Empty>{state.error}</Empty>}
						{stats && (
							<FlowList
								laneId={swimlane.id}
								testId="lane-arrives-toggle"
								flows={stats.arrivesFrom}
								empty="Nothing has ever been here"
							/>
						)}
					</Section>

					<Section title="Usually moves on to">
						{stats && (
							<FlowList
								laneId={swimlane.id}
								testId="lane-moves-toggle"
								flows={stats.movesOnTo}
								empty="Nothing has left this lane yet"
							/>
						)}
					</Section>
				</>
			)}
		</Aside>
	);
};
