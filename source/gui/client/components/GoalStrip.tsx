// A board's goals, above its lanes: one pill each, underlined as far as its
// tickets are done. A pill narrows the board to its goal; pressing it again
// lets go.

import {GuiBoardGoal} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {GoalProgressLine} from './GoalLabel';

const GoalPill = ({
	goal,
	pressed,
	onPress,
}: {
	goal: GuiBoardGoal;
	pressed: boolean;
	onPress: () => void;
}) => {
	const share = goal.total > 0 ? goal.done / goal.total : 0;
	// Counted on every board; said, as the filter shows only this one's.
	const elsewhere =
		goal.here < goal.total ? `, ${goal.total - goal.here} on other boards` : '';

	return (
		<button
			type="button"
			data-testid="goal-pill"
			data-goal-id={goal.id}
			aria-pressed={pressed}
			title={
				pressed
					? 'Show every ticket again'
					: `${goal.done} of ${goal.total} done${elsewhere} · show only this goal`
			}
			onClick={event => {
				event.stopPropagation();
				onPress();
			}}
			style={{
				position: 'relative',
				overflow: 'hidden',
				display: 'inline-flex',
				alignItems: 'center',
				gap: 8,
				maxWidth: 220,
				flexShrink: 0,
				boxSizing: 'border-box',
				height: 26,
				padding: '0 10px',
				font: 'inherit',
				fontSize: 11,
				lineHeight: 1,
				color: goal.color,
				background: GUI_THEME.panel,
				border: `1px solid ${pressed ? goal.color : GUI_THEME.line}`,
				borderRadius: 6,
				cursor: 'pointer',
			}}
		>
			{/* Along its foot, clear of the rounded corners. */}
			<GoalProgressLine
				color={goal.color}
				share={share}
				thickness={2}
				testId="goal-pill-progress"
				style={{position: 'absolute', left: 6, right: 6, bottom: 2}}
			/>
			<span
				style={{
					position: 'relative',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap',
				}}
			>
				{goal.name}
			</span>
			<span
				style={{
					position: 'relative',
					color: GUI_THEME.dim,
					fontSize: 10,
					fontVariantNumeric: 'tabular-nums',
				}}
			>
				{goal.done}/{goal.total}
			</span>
		</button>
	);
};

export const GoalStrip = ({
	goals,
	isolatedGoalId,
	onFilterByGoal,
	onManage,
}: {
	goals: GuiBoardGoal[];
	isolatedGoalId: string | null;
	onFilterByGoal: (goalId: string) => void;
	onManage?: () => void;
}) => (
	<div
		data-testid="goal-strip"
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 6,
			padding: '14px 0 10px',
			overflowX: 'auto',
			flexShrink: 0,
		}}
	>
		{goals.map(goal => (
			<GoalPill
				key={goal.id}
				goal={goal}
				pressed={goal.id === isolatedGoalId}
				onPress={() => onFilterByGoal(goal.id)}
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
