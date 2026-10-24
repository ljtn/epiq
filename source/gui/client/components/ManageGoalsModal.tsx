import {useState} from 'react';
import {GoalIndex} from '../lib/goal-index';
import {GuiIssue} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {manageRowStyle} from '../lib/manage-row.style';
import {Button} from './Button';
import {IconTrash} from './IconTrash';

type Props = {
	goals: GoalIndex;
	// Every ticket there is, for the goals' titles.
	issues: GuiIssue[];
	onOpen: (goalId: string) => void;
	onRemove: (goalId: string) => void;
	onClose: () => void;
};

export const ManageGoalsModal = ({
	goals,
	issues,
	onOpen,
	onRemove,
	onClose,
}: Props) => {
	// Two-step, as removing a tag is: the first click arms one row, the
	// second commits it.
	const [armedId, setArmedId] = useState<string | null>(null);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	const byId = new Map(issues.map(issue => [issue.id, issue]));
	const rows = [...goals.values()]
		.flatMap(goal => {
			const issue = byId.get(goal.id);
			return issue ? [{goal, issue}] : [];
		})
		.sort((a, b) => a.issue.title.localeCompare(b.issue.title));

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: GUI_THEME.scrim,
				backdropFilter: 'blur(.5px)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 1000,
			}}
			onMouseDown={onClose}
		>
			<div
				data-testid="manage-goals"
				onMouseDown={event => event.stopPropagation()}
				style={{
					marginTop: '-100px',
					width: 460,
					background: GUI_THEME.panel,
					border: `1px solid ${GUI_THEME.line}`,
					borderRadius: 12,
					padding: 20,
					display: 'flex',
					flexDirection: 'column',
					gap: 14,
				}}
			>
				<div
					style={{
						color: GUI_THEME.secondary,
						fontSize: 10,
						letterSpacing: 1,
						textTransform: 'uppercase',
					}}
				>
					Manage goals
				</div>

				<div style={{fontSize: 12, color: GUI_THEME.secondary}}>
					Removing a goal takes every ticket out of it. The goal's own ticket
					stays on the board.
				</div>

				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: 2,
						maxHeight: 260,
						overflowY: 'auto',
					}}
				>
					{rows.length === 0 && (
						<span style={{fontSize: 12, color: GUI_THEME.dim}}>No goals</span>
					)}
					{rows.map(({goal, issue}) => {
						const armed = armedId === goal.id;
						const hovered = hoveredId === goal.id;

						return (
							<div
								key={goal.id}
								data-testid="manage-goal-row"
								data-armed={armed ? 'true' : 'false'}
								onMouseEnter={() => setHoveredId(goal.id)}
								onMouseLeave={() =>
									setHoveredId(current =>
										current === goal.id ? null : current,
									)
								}
								style={manageRowStyle({armed, hovered})}
							>
								<button
									type="button"
									data-testid="manage-goal-open"
									onClick={() => onOpen(goal.id)}
									style={{
										display: 'flex',
										alignItems: 'baseline',
										gap: 8,
										minWidth: 0,
										padding: '0 0 0 8px',
										borderWidth: '0 0 0 2px',
										borderStyle: 'solid',
										borderColor: goal.color,
										background: 'transparent',
										fontFamily: 'inherit',
										cursor: 'pointer',
										textAlign: 'left',
									}}
								>
									<span style={{fontSize: 12, color: goal.color}}>
										{issue.title}
									</span>
									<span style={{fontSize: 10, color: GUI_THEME.dim}}>
										{goal.done}/{goal.members.length}
									</span>
								</button>

								<Button
									variant="ghost"
									testId="remove-goal"
									title={
										armed
											? `Click again to take every ticket out of "${issue.title}"`
											: `Remove "${issue.title}"`
									}
									onClick={() => {
										if (!armed) return setArmedId(goal.id);

										onRemove(goal.id);
										setArmedId(null);
									}}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 6,
										color: armed ? GUI_THEME.red : GUI_THEME.dim,
										// The whole shorthand, and only when armed: see
										// ManageTagsModal.
										...(armed ? {border: `1px solid ${GUI_THEME.red}`} : {}),
									}}
								>
									{armed && <span style={{fontSize: 10}}>Confirm</span>}
									<IconTrash />
								</Button>
							</div>
						);
					})}
				</div>

				<div style={{display: 'flex', justifyContent: 'flex-end'}}>
					<Button variant="ghost" onClick={onClose}>
						Close
					</Button>
				</div>
			</div>
		</div>
	);
};
