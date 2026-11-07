// A board's goals, above its lanes: one pill each, underlined as far as its
// tickets are done. A pill opens its goal's panel; its funnel narrows the
// board to the goal, and pressing that again lets go.

import {GuiBoardGoal} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {goalFilterTitle, GoalProgressLine} from './GoalMarks';
import {ICON_SIZE, IconButton} from './IconButton';
import {IconFunnel} from './IconFunnel';
import {COLUMN_PADDING} from './SwimlaneColumn';

const GoalPill = ({
	goal,
	narrowed,
	selected,
	onOpen,
	onFilter,
}: {
	goal: GuiBoardGoal;
	narrowed: boolean;
	// Its panel is the one open.
	selected: boolean;
	onOpen: () => void;
	onFilter: () => void;
}) => {
	const share = goal.total > 0 ? goal.done / goal.total : 0;
	// Counted on every board; said, as the filter shows only this one's.
	const away = goal.total - goal.members.length;
	const elsewhere = away > 0 ? `, ${away} on other boards` : '';

	return (
		<div
			data-testid="goal-pill"
			data-goal-id={goal.id}
			data-selected={selected}
			style={{
				position: 'relative',
				overflow: 'hidden',
				display: 'inline-flex',
				maxWidth: 220,
				flexShrink: 0,
				boxSizing: 'border-box',
				height: 26,
				fontSize: 11,
				lineHeight: 1,
				color: GUI_THEME.secondary,
				background: selected ? GUI_THEME.selectedWash : GUI_THEME.panel,
				border: `1px solid ${
					narrowed
						? goal.color
						: selected
						? GUI_THEME.accentEdge
						: GUI_THEME.line
				}`,
				borderRadius: 6,
			}}
		>
			<button
				type="button"
				data-testid="goal-pill-open"
				aria-expanded={selected}
				title={`${goal.done} of ${goal.total} done${elsewhere}`}
				onClick={event => {
					event.stopPropagation();
					onOpen();
				}}
				style={{
					display: 'inline-flex',
					alignItems: 'center',
					gap: 8,
					minWidth: 0,
					padding: '0 8px 0 10px',
					color: 'inherit',
					background: 'transparent',
					border: 'none',
					font: 'inherit',
					cursor: 'pointer',
					// The pill clips what would fall outside it.
					outlineOffset: -2,
				}}
			>
				<span
					style={{
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{goal.name}
				</span>
				<span
					style={{
						color: GUI_THEME.dim,
						fontSize: 10,
						fontVariantNumeric: 'tabular-nums',
					}}
				>
					{goal.done}/{goal.total}
				</span>
			</button>
			<IconButton
				testId="goal-pill-filter"
				title={goalFilterTitle(narrowed)}
				pressed={narrowed}
				onClick={event => {
					event.stopPropagation();
					onFilter();
				}}
			>
				<span
					style={{
						display: 'inline-flex',
						color: narrowed ? goal.color : undefined,
					}}
				>
					<IconFunnel size={ICON_SIZE} />
				</span>
			</IconButton>
			{/* Along its foot, clear of the rounded corners. */}
			<GoalProgressLine
				color={goal.color}
				share={share}
				thickness={2}
				testId="goal-pill-progress"
				style={{
					position: 'absolute',
					left: 6,
					right: 6,
					bottom: 2,
					pointerEvents: 'none',
				}}
			/>
		</div>
	);
};

export const GoalStrip = ({
	goals,
	isolatedGoalId,
	selectedGoalId,
	onOpenGoal,
	onFilterByGoal,
	onManage,
}: {
	goals: GuiBoardGoal[];
	isolatedGoalId: string | null;
	selectedGoalId: string | null;
	onOpenGoal: (goalId: string) => void;
	onFilterByGoal: (goalId: string) => void;
	onManage?: () => void;
}) => (
	<div
		data-testid="goal-strip"
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 6,
			// In from the board's edge as far as a lane's title is.
			padding: `14px ${COLUMN_PADDING}px 10px`,
			overflowX: 'auto',
			flexShrink: 0,
		}}
	>
		{goals.map(goal => (
			<GoalPill
				key={goal.id}
				goal={goal}
				narrowed={goal.id === isolatedGoalId}
				selected={goal.id === selectedGoalId}
				onOpen={() => onOpenGoal(goal.id)}
				onFilter={() => onFilterByGoal(goal.id)}
			/>
		))}
		{onManage && (
			<Button
				variant="ghost"
				testId="goal-strip-manage"
				onClick={event => {
					event.stopPropagation();
					onManage();
				}}
				style={{fontSize: 11, color: GUI_THEME.dim, flexShrink: 0}}
			>
				Manage goals
			</Button>
		)}
	</div>
);
