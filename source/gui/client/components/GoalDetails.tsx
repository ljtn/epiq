// A goal's panel, opened from its pill: how far along it is, and every
// ticket in it, on whichever board, each a way to that ticket.

import {useState} from 'react';
import {CLOSED_BOARD_ID} from '../../../lib/board/static-ids.js';
import {AsideDock} from '../lib/aside-dock';
import {GuiBoard, GuiGoal, GuiIssue} from '../lib/gui-state.model';
import {GoalStatsState} from '../lib/use-goal-stats';
import {GUI_THEME} from '../lib/gui-theme';
import {statGrid, statsAcross} from '../lib/issue-stats.style';
import {Aside, ASIDE_PADDING, readStoredAsideWidth} from './Aside';
import {Empty} from './FormPrimitives';
import {GoalProgressLine} from './GoalLabel';
import {IconCheck} from './IconCheck';
import {IconChevronRight} from './IconChevronRight';
import {CopyRef} from './CopyRef';
import {DetailsHeader} from './NodeDetails';
import {Section} from './Section';
import {Stat} from './StatRow';
import {IssueStats} from './IssueStats';
import {Tabs} from './Tabs';

export type GoalDetailsTab = 'overview' | 'stats';

type Member = {issue: GuiIssue; lane: string; done: boolean};
type Group = {board: GuiBoard; members: Member[]};

// Each ticket once, under the first board that shows it: this one, then the
// others by rank, the Closed board last. Open tickets lead each group.
const groupsOf = (
	goalId: string,
	boards: GuiBoard[],
	boardId: string,
): Group[] => {
	const found = new Map<string, {issue: GuiIssue; lane: string}>();
	for (const board of boards) {
		for (const lane of board.swimlanes) {
			for (const issue of lane.issues) {
				found.set(issue.id, {issue, lane: lane.title});
			}
		}
	}

	const rank = (board: GuiBoard) =>
		board.id === boardId ? 0 : board.id === CLOSED_BOARD_ID ? 2 : 1;
	const seen = new Set<string>();

	return [...boards]
		.sort((a, b) => rank(a) - rank(b))
		.map(board => {
			const shown = board.goals.find(goal => goal.id === goalId)?.members ?? [];
			const members = shown.flatMap(({id, done}) => {
				const at = found.get(id);
				if (!at || seen.has(id)) return [];
				seen.add(id);
				return [{...at, done}];
			});
			return {
				board,
				members: [
					...members.filter(member => !member.done),
					...members.filter(member => member.done),
				],
			};
		})
		.filter(group => group.members.length > 0);
};

// The ref copies, as a ticket panel's does; the rest of the row opens the
// ticket. Two buttons side by side, as one cannot hold the other.
const MemberRow = ({
	member,
	color,
	onOpen,
}: {
	member: Member;
	color: string;
	onOpen: () => void;
}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<div
			data-testid="goal-member"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 10,
				borderRadius: 6,
				padding: '7px 8px 7px 10px',
				fontSize: 12,
				background: hovered ? GUI_THEME.raisedHover : GUI_THEME.raised,
				transition: 'background 120ms ease',
			}}
		>
			<span
				style={{
					display: 'flex',
					flexShrink: 0,
					color: member.done ? color : GUI_THEME.faint,
				}}
			>
				{member.done ? (
					<IconCheck size={12} />
				) : (
					<span
						style={{
							width: 8,
							height: 8,
							margin: 2,
							borderRadius: '50%',
							border: `1.5px solid ${color}`,
						}}
					/>
				)}
			</span>
			<span style={{flexShrink: 0, fontSize: 11}}>
				<CopyRef refValue={member.issue.ref} />
			</span>
			<button
				type="button"
				data-testid="goal-member-open"
				onClick={onOpen}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 8,
					flex: 1,
					minWidth: 0,
					padding: 0,
					border: 'none',
					background: 'transparent',
					font: 'inherit',
					textAlign: 'left',
					cursor: 'pointer',
				}}
			>
				<span
					style={{
						flex: 1,
						minWidth: 0,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						color: member.done
							? GUI_THEME.secondary
							: hovered
							? GUI_THEME.primary
							: GUI_THEME.primarySoft,
						textDecoration: member.issue.isClosed ? 'line-through' : undefined,
						transition: 'color 120ms ease',
					}}
				>
					{member.issue.title}
				</span>
				<span
					style={{
						flexShrink: 0,
						padding: '1px 7px',
						borderRadius: 999,
						fontSize: 10,
						color: GUI_THEME.secondary,
						background: GUI_THEME.hover,
						border: `1px solid ${GUI_THEME.line}`,
					}}
				>
					{member.lane}
				</span>
				<span
					style={{
						display: 'flex',
						flexShrink: 0,
						color: hovered ? GUI_THEME.primary : GUI_THEME.faint,
						transition: 'color 120ms ease',
					}}
				>
					<IconChevronRight size={14} />
				</span>
			</button>
		</div>
	);
};

export const GoalDetails = ({
	dock,
	goal,
	boards,
	boardId,
	tab,
	onChangeTab,
	stats,
	onOpenIssue,
	onClose,
}: {
	dock: AsideDock;
	goal: GuiGoal;
	boards: GuiBoard[];
	// The board on screen, whose tickets come first.
	boardId: string;
	tab: GoalDetailsTab;
	onChangeTab: (tab: GoalDetailsTab) => void;
	stats: GoalStatsState | null;
	onOpenIssue: (issueId: string, boardRef: string) => void;
	onClose: () => void;
}) => {
	const [panelWidth, setPanelWidth] = useState(readStoredAsideWidth);
	const groups = groupsOf(goal.id, boards, boardId);
	const share = goal.total > 0 ? goal.done / goal.total : 0;
	const here =
		boards
			.find(board => board.id === boardId)
			?.goals.find(shown => shown.id === goal.id)?.members.length ?? 0;

	const row = (board: GuiBoard) => (member: Member) =>
		(
			<MemberRow
				key={member.issue.id}
				member={member}
				color={goal.color}
				onOpen={() => onOpenIssue(member.issue.id, board.ref)}
			/>
		);

	return (
		<Aside dock={dock} onWidthChange={setPanelWidth}>
			<DetailsHeader
				testId="goal-details"
				kind="Goal"
				title={goal.name}
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

			{tab === 'stats' ? (
				<IssueStats
					of="goal"
					stats={stats?.stats ?? null}
					loading={stats?.loading ?? true}
					error={stats?.error ?? null}
					boardStats={null}
					across={statsAcross(panelWidth - 2 * ASIDE_PADDING)}
				/>
			) : (
				<>
					<Section title="Progress" first>
						<div style={statGrid(3, 3)}>
							<Stat
								size="compact"
								value={`${goal.done}/${goal.total}`}
								label="Done"
								testId="goal-details-done"
							/>
							<Stat
								size="compact"
								value={`${Math.round(share * 100)}%`}
								label="Of the goal"
							/>
							<Stat
								size="compact"
								value={String(here)}
								testId="goal-details-here"
								label="On this board"
							/>
						</div>
						<GoalProgressLine
							color={goal.color}
							share={share}
							thickness={4}
							style={{marginTop: 16}}
						/>
					</Section>

					{groups.length === 0 && (
						<Section title="Tickets">
							<Empty>No tickets yet</Empty>
						</Section>
					)}

					{groups.map(({board, members}) => (
						<Section
							key={board.id}
							title={
								board.id === boardId
									? 'On this board'
									: board.id === CLOSED_BOARD_ID
									? 'Closed'
									: `On ${board.title}`
							}
						>
							<div
								data-testid="goal-group"
								style={{
									marginTop: 8,
									display: 'flex',
									flexDirection: 'column',
									gap: 4,
								}}
							>
								{members.map(row(board))}
							</div>
						</Section>
					))}
				</>
			)}
		</Aside>
	);
};
