// A board's goals, above its lanes: one pill each, underlined as far as its
// tickets are done. A pill opens its goal's panel.

import {GuiBoardGoal} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {GoalMark, GoalProgressLine} from './GoalMarks';
import {COLUMN_PADDING} from './SwimlaneColumn';

const GoalPill = ({
	goal,
	narrowed,
	selected,
	onOpen,
}: {
	goal: GuiBoardGoal;
	// The board filter is narrowed to it.
	narrowed: boolean;
	// Its panel is the one open.
	selected: boolean;
	onOpen: () => void;
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
			data-narrowed={narrowed}
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
					padding: '0 10px',
					color: 'inherit',
					background: 'transparent',
					border: 'none',
					font: 'inherit',
					cursor: 'pointer',
					// The pill clips what would fall outside it.
					outlineOffset: -2,
				}}
			>
				<GoalMark color={goal.color} />
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
	narrowedGoalIds,
	selectedGoalId,
	onOpenGoal,
	onManage,
}: {
	goals: GuiBoardGoal[];
	// The goals the board filter is narrowed to, or null where it names none.
	narrowedGoalIds: readonly string[] | null;
	selectedGoalId: string | null;
	onOpenGoal: (goalId: string) => void;
	onManage?: () => void;
}) => (
	<div
		data-testid="goal-strip"
		style={{
			// In from the board's edge as far as a lane's title is.
			padding: `10px ${COLUMN_PADDING}px`,
			flexShrink: 0,
		}}
	>
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 6,
				overflowX: 'auto',
			}}
		>
			{goals.map(goal => (
				<GoalPill
					key={goal.id}
					goal={goal}
					narrowed={narrowedGoalIds?.includes(goal.id) ?? false}
					selected={goal.id === selectedGoalId}
					onOpen={() => onOpenGoal(goal.id)}
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
	</div>
);
