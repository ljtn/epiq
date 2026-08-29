import {useState} from 'react';
import {GuiTag} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
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

	const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: 'rgba(0, 0, 0, 0.25)',
				backdropFilter: 'blur(.5px)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 1000,
			}}
			onMouseDown={onClose}
		>
			<div
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
					Manage tags
				</div>

				<div style={{fontSize: 12, color: GUI_THEME.secondary}}>
					Delete tags across the whole workspace. A deleted tag comes off every
					ticket at once; its history stays in the log.
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
					{sorted.map(tag => {
						const armed = armedId === tag.id;

						return (
							<div
								key={tag.id}
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									gap: 8,
									padding: '6px 8px',
									borderRadius: 6,
								}}
							>
								<span style={{fontSize: 12, color: tag.color}}>{tag.name}</span>

								<Button
									variant="ghost"
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
										borderColor: armed ? GUI_THEME.red : undefined,
									}}
								>
									{armed && <span style={{fontSize: 10}}>confirm</span>}
									<IconTrash />
								</Button>
							</div>
						);
					})}
				</div>

				<div style={{display: 'flex', justifyContent: 'flex-end'}}>
					<Button variant="ghost" onClick={onClose}>
						close
					</Button>
				</div>
			</div>
		</div>
	);
};
