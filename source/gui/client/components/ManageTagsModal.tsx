import {useState} from 'react';
import {GuiTag} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {manageRowStyle} from '../lib/manage-row.style';
import {Button} from './Button';
import {Modal, ModalList, ModalText} from './Modal';
import {IconTrash} from './IconTrash';

type Props = {
	tags: GuiTag[];
	onDelete: (tagId: string) => void;
	onClose: () => void;
};

export const ManageTagsModal = ({tags, onDelete, onClose}: Props) => {
	// Two-step: the first click arms one row, the second commits it. Arming by
	// id rather than a boolean so moving to another row cancels the first.
	const [armedId, setArmedId] = useState<string | null>(null);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));

	return (
		<Modal
			eyebrow="Manage tags"
			onClose={onClose}
			actions={
				<Button variant="ghost" onClick={onClose}>
					Close
				</Button>
			}
		>
			<ModalText>
				Delete tags across the whole workspace. A deleted tag comes off every
				ticket at once; its history stays in the log.
			</ModalText>

			<ModalList>
				{sorted.map(tag => {
					const armed = armedId === tag.id;
					const hovered = hoveredId === tag.id;

					return (
						<div
							key={tag.id}
							data-testid="manage-tag-row"
							data-armed={armed ? 'true' : 'false'}
							onMouseEnter={() => setHoveredId(tag.id)}
							onMouseLeave={() =>
								setHoveredId(current => (current === tag.id ? null : current))
							}
							style={manageRowStyle({armed, hovered})}
						>
							<span style={{color: tag.color}}>{tag.name}</span>

							<Button
								variant="ghost"
								testId="delete-tag"
								title={
									armed
										? `Click again to delete "${tag.name}" everywhere`
										: `Delete "${tag.name}"`
								}
								onClick={() => {
									if (!armed) return setArmedId(tag.id);

									onDelete(tag.id);
									setArmedId(null);
								}}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 6,
									color: armed ? GUI_THEME.red : GUI_THEME.dim,
									// The whole shorthand, and only when armed: Button sets
									// `border` itself, and React warns that an element given
									// both it and `borderColor` can drop whichever loses the
									// race. Spreading `border: undefined` is not the other
									// branch — that reads as "remove this style".
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
