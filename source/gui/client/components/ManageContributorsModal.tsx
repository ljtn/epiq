import {useState} from 'react';
import {GuiContributor} from '../lib/gui-state.model';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {manageRowStyle} from '../lib/manage-row.style';
import {Button} from './Button';
import {IconLock} from './IconLock';
import {IconTrash} from './IconTrash';
import {Modal, ModalList, ModalText} from './Modal';

type Props = {
	contributors: GuiContributor[];
	onRemove: (contributorId: string) => void;
	onClose: () => void;
};

export const ManageContributorsModal = ({
	contributors,
	onRemove,
	onClose,
}: Props) => {
	// Two-step: the first click arms one row, the second commits it. Arming by
	// id rather than a boolean so moving to another row cancels the first.
	const [armedId, setArmedId] = useState<string | null>(null);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	// Everyone is listed, including those that can't be removed: omitting them
	// would just look like a missing name.
	const sorted = [...contributors].sort((a, b) => a.name.localeCompare(b.name));

	return (
		<Modal
			eyebrow="Manage external contributors"
			onClose={onClose}
			actions={
				<Button variant="ghost" onClick={onClose}>
					Close
				</Button>
			}
		>
			<ModalText>
				Remove contributors from the suggestion lists. Locked ones have
				contributed, so their name is in the immutable log either way.
			</ModalText>

			<ModalList>
				{sorted.map(contributor => {
					const locked = contributor.hasAuthoredAnywhere;
					const armed = armedId === contributor.id;

					return (
						<div
							key={contributor.id}
							data-testid="manage-contributor-row"
							data-armed={armed ? 'true' : 'false'}
							onMouseEnter={() => setHoveredId(contributor.id)}
							onMouseLeave={() =>
								setHoveredId(current =>
									current === contributor.id ? null : current,
								)
							}
							style={manageRowStyle({
								armed,
								hovered: hoveredId === contributor.id,
							})}
						>
							<span
								style={{
									color: contributor.color,
									opacity: locked ? 0.5 : 1,
								}}
							>
								@{contributor.name}
							</span>

							{locked ? (
								<span
									title="Has contributed — their name is in the immutable log either way"
									style={{
										display: 'flex',
										color: GUI_THEME.dim,
										opacity: 0.7,
										// Matches the ghost button's padding so locked and
										// removable rows keep the same height.
										padding: '3px 6px',
									}}
								>
									<IconLock />
								</span>
							) : contributor.isRemoved ? (
								<span style={{color: GUI_THEME.dim, fontSize: TEXT.label}}>
									Removed
								</span>
							) : (
								<Button
									variant="ghost"
									title={
										armed
											? `Click again to remove @${contributor.name}`
											: `Remove @${contributor.name}`
									}
									onClick={() => {
										if (!armed) return setArmedId(contributor.id);

										onRemove(contributor.id);
										setArmedId(null);
									}}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 6,
										color: armed ? GUI_THEME.red : GUI_THEME.dim,
										// The whole shorthand, only when armed: Button sets `border`, and mixing in
										// `borderColor` makes React warn. `border: undefined` would remove the style.
										...(armed ? {border: `1px solid ${GUI_THEME.red}`} : {}),
									}}
								>
									{armed && 'Confirm'}
									<IconTrash />
								</Button>
							)}
						</div>
					);
				})}
			</ModalList>
		</Modal>
	);
};
