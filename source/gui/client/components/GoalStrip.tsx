// A board's goals, above its lanes: one pill each, underlined as far as its
// tickets are done. A pill opens its goal's panel; its funnel narrows the
// board to the goal, and pressing that again lets go.

import {CSSProperties} from 'react';
import {GuiBoardGoal} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {GoalProgressLine} from './GoalMarks';
import {IconFunnel} from './IconFunnel';
import {COLUMN_PADDING} from './SwimlaneColumn';

const GoalPill = ({
	goal,
	narrowed,
	onOpen,
	onFilter,
}: {
	goal: GuiBoardGoal;
	narrowed: boolean;
	onOpen: () => void;
	onFilter: () => void;
}) => {
	const share = goal.total > 0 ? goal.done / goal.total : 0;
	// Counted on every board; said, as the filter shows only this one's.
	const away = goal.total - goal.members.length;
	const elsewhere = away > 0 ? `, ${away} on other boards` : '';
	const filterLabel = narrowed ? 'Show every ticket' : 'Show only this goal';
	const zone: CSSProperties = {
		display: 'inline-flex',
		alignItems: 'center',
		border: 'none',
		font: 'inherit',
		cursor: 'pointer',
	};

	return (
		<div
			data-testid="goal-pill"
			data-goal-id={goal.id}
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
				color: goal.color,
				background: GUI_THEME.panel,
				border: `1px solid ${narrowed ? goal.color : GUI_THEME.line}`,
				borderRadius: 6,
			}}
		>
			<button
				type="button"
				data-testid="goal-pill-open"
				title={`${goal.done} of ${goal.total} done${elsewhere}`}
				onClick={event => {
					event.stopPropagation();
					onOpen();
				}}
				style={{
					...zone,
					gap: 8,
					minWidth: 0,
					padding: '0 8px 0 10px',
					color: 'inherit',
					background: 'transparent',
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
			<button
				type="button"
				data-testid="goal-pill-filter"
				aria-label={filterLabel}
				aria-pressed={narrowed}
				title={filterLabel}
				onClick={event => {
					event.stopPropagation();
					onFilter();
				}}
				style={{
					...zone,
					flexShrink: 0,
					padding: '0 6px',
					borderLeft: `1px solid ${GUI_THEME.line}`,
					color: narrowed ? goal.color : GUI_THEME.dim,
					background: narrowed ? GUI_THEME.line : 'transparent',
				}}
			>
				<IconFunnel size={12} />
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
	isolatedGoalId,
	onOpenGoal,
	onFilterByGoal,
	onManage,
}: {
	goals: GuiBoardGoal[];
	isolatedGoalId: string | null;
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
