import {useState} from 'react';
import {GuiContributor} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {IconTrash} from './IconTrash';

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

	// Everyone is listed, including those that can't be removed: omitting them
	// would just look like a missing name.
	const sorted = [...contributors].sort((a, b) => a.name.localeCompare(b.name));

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
					Manage external contributors
				</div>

				<div style={{fontSize: 12, color: GUI_THEME.secondary}}>
					Removes an external contributor from the suggestion lists. Anyone who
					has contributed stays, since their name is in the log.
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
					{sorted.map(contributor => {
						// Keyed on `hasAuthoredAnywhere`, not `isExternal`: the latter is
						// board-scoped, so someone who authored on another board would
						// look removable here and then be refused by the server.
						const blockedReason = contributor.isRemoved
							? 'already removed'
							: contributor.hasAuthoredAnywhere
							? 'has contributed'
							: null;

						const armed = armedId === contributor.id;

						return (
							<div
								key={contributor.id}
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									gap: 8,
									padding: '6px 8px',
									borderRadius: 6,
								}}
							>
								<span style={{fontSize: 12, color: contributor.color}}>
									@{contributor.name}
								</span>

								{blockedReason ? (
									<span style={{color: GUI_THEME.dim, fontSize: 10}}>
										{blockedReason}
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
											borderColor: armed ? GUI_THEME.red : undefined,
										}}
									>
										{armed && <span style={{fontSize: 10}}>confirm</span>}
										<IconTrash />
									</Button>
								)}
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
