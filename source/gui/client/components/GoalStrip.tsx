// A board's goals, above its lanes: one pill each, filled as far as its
// tickets are done. A pill narrows the board to its goal; pressing it again
// lets go.

import {GuiGoal} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';

const GoalPill = ({
	goal,
	pressed,
	onPress,
}: {
	goal: GuiGoal;
	pressed: boolean;
	onPress: () => void;
}) => {
	const share = goal.total > 0 ? goal.done / goal.total : 0;

	return (
		<button
			type="button"
			data-testid="goal-pill"
			data-goal-id={goal.id}
			aria-pressed={pressed}
			title={
				pressed
					? 'Show every ticket again'
					: `${goal.done} of ${goal.total} done · show only this goal`
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
				height: 24,
				padding: '0 10px',
				font: 'inherit',
				fontSize: 11,
				lineHeight: 1,
				color: goal.color,
				background: GUI_THEME.well,
				border: `1px solid ${pressed ? goal.color : GUI_THEME.line}`,
				borderRadius: 6,
				cursor: 'pointer',
			}}
		>
			{/* The pill is its own progress bar. */}
			<span
				aria-hidden
				data-testid="goal-pill-fill"
				style={{
					position: 'absolute',
					inset: '0 auto 0 0',
					width: `${Math.round(share * 100)}%`,
					background: `${goal.color}33`,
					pointerEvents: 'none',
				}}
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
	goals: GuiGoal[];
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
			padding: '10px 0 2px',
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
