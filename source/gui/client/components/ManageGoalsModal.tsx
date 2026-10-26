import {useState} from 'react';
import {GuiGoal} from '../lib/gui-state.model';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {manageRowStyle} from '../lib/manage-row.style';
import {Button} from './Button';
import {Input} from './FormPrimitives';
import {IconTrash} from './IconTrash';
import {Modal, ModalList} from './Modal';

type Props = {
	// The project's goals.
	goals: GuiGoal[];
	onCreate: (name: string) => void;
	onRename: (goalId: string, name: string) => void;
	onRemove: (goalId: string) => void;
	onClose: () => void;
};

export const ManageGoalsModal = ({
	goals,
	onCreate,
	onRename,
	onRemove,
	onClose,
}: Props) => {
	// Two-step, as removing a tag is: the first click arms one row, the
	// second commits it.
	const [armedId, setArmedId] = useState<string | null>(null);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const [editing, setEditing] = useState<{id: string; name: string} | null>(
		null,
	);
	const [draft, setDraft] = useState('');

	const taken = (name: string, exceptId?: string) =>
		goals.some(
			goal =>
				goal.id !== exceptId &&
				goal.name.toLowerCase() === name.trim().toLowerCase(),
		);
	const canAdd = draft.trim() !== '' && !taken(draft);
	const add = () => {
		if (!canAdd) return;
		onCreate(draft.trim());
		setDraft('');
	};

	const commitRename = () => {
		if (!editing) return;
		const name = editing.name.trim();
		if (name && !taken(name, editing.id)) onRename(editing.id, name);
		setEditing(null);
	};

	return (
		<Modal
			testId="manage-goals"
			eyebrow="Manage goals"
			onClose={onClose}
			actions={
				<Button variant="ghost" onClick={onClose}>
					Close
				</Button>
			}
		>
			<div style={{display: 'flex', gap: 8}}>
				<Input
					data-testid="new-goal-name"
					value={draft}
					placeholder="New goal"
					onChange={event => setDraft(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Enter') add();
					}}
				/>
				<Button testId="add-goal" disabled={!canAdd} onClick={add}>
					Add
				</Button>
			</div>

			<ModalList>
				{goals.length === 0 && (
					<span style={{color: GUI_THEME.dim}}>No goals</span>
				)}
				{goals.map(goal => {
					const armed = armedId === goal.id;
					const hovered = hoveredId === goal.id;

					return (
						<div
							key={goal.id}
							data-testid="manage-goal-row"
							data-armed={armed ? 'true' : 'false'}
							onMouseEnter={() => setHoveredId(goal.id)}
							onMouseLeave={() =>
								setHoveredId(current => (current === goal.id ? null : current))
							}
							style={manageRowStyle({armed, hovered})}
						>
							{editing?.id === goal.id ? (
								<Input
									autoFocus
									data-testid="rename-goal-input"
									value={editing.name}
									onChange={event =>
										setEditing({id: goal.id, name: event.target.value})
									}
									onBlur={commitRename}
									onKeyDown={event => {
										if (event.key === 'Enter') commitRename();
										// Leaves the rename, not the dialog.
										if (event.key === 'Escape') {
											event.stopPropagation();
											setEditing(null);
										}
									}}
									style={{padding: '4px 8px'}}
								/>
							) : (
								<button
									type="button"
									data-testid="rename-goal"
									title="Rename"
									onClick={() => setEditing({id: goal.id, name: goal.name})}
									style={{
										display: 'flex',
										alignItems: 'baseline',
										gap: 8,
										minWidth: 0,
										padding: '0 0 0 8px',
										borderWidth: '0 0 0 3px',
										borderStyle: 'solid',
										borderColor: goal.color,
										background: 'transparent',
										font: 'inherit',
										cursor: 'text',
										textAlign: 'left',
									}}
								>
									<span style={{color: goal.color}}>{goal.name}</span>
									<span style={{fontSize: TEXT.label, color: GUI_THEME.dim}}>
										{goal.done}/{goal.total}
									</span>
								</button>
							)}

							<Button
								variant="ghost"
								testId="remove-goal"
								title={
									armed
										? `Click again to remove "${goal.name}"`
										: `Remove "${goal.name}"`
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
								{armed && 'Confirm'}
								<IconTrash />
							</Button>
						</div>
					);
				})}
			</ModalList>
		</Modal>
	);
};
