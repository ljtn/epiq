import {useState} from 'react';
import {GuiContributor} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {Checkbox} from './Checkbox';

type Props = {
	contributors: GuiContributor[];
	onRedact: (contributorIds: string[]) => void;
	onClose: () => void;
};

// Its own modal, not inline in the assignee picker: clearing a name is
// workspace-wide and permanent, and a control among per-issue chips reads as
// issue-scoped.
export const RedactContributorsModal = ({
	contributors,
	onRedact,
	onClose,
}: Props) => {
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [confirming, setConfirming] = useState(false);

	// Everyone is listed, including those who can't be redacted: omitting them
	// would just look like a missing name.
	const sorted = [...contributors].sort((a, b) => a.name.localeCompare(b.name));

	const toggle = (id: string) =>
		setSelectedIds(prev =>
			prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
		);

	const selectedNames = sorted
		.filter(c => selectedIds.includes(c.id))
		.map(c => c.name);

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
						color: GUI_THEME.red,
						fontSize: 10,
						letterSpacing: 1,
						textTransform: 'uppercase',
					}}
				>
					Manage contributors
				</div>

				<div style={{fontSize: 12, color: GUI_THEME.secondary}}>
					Redact a contributor's name. Active contributors cannot be
					programmatically redacted, since their name is also in the immutable
					log.
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
						// look redactable here and then be refused by the server.
						const blockedReason = contributor.isRedacted
							? 'already redacted'
							: contributor.hasAuthoredAnywhere
							? 'has contributed — name is in the history'
							: null;

						return (
							<div
								key={contributor.id}
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 8,
									padding: '6px 8px',
									borderRadius: 6,
									background: selectedIds.includes(contributor.id)
										? 'rgba(255, 255, 255, 0.04)'
										: 'transparent',
								}}
							>
								<Checkbox
									label={
										<span style={{fontSize: 12, color: contributor.color}}>
											@{contributor.name}
										</span>
									}
									checked={selectedIds.includes(contributor.id)}
									disabled={Boolean(blockedReason)}
									activeColor={GUI_THEME.red}
									title={blockedReason ?? 'Redact this name'}
									onChange={() => toggle(contributor.id)}
								/>

								{blockedReason && (
									<span style={{color: GUI_THEME.dim, fontSize: 10}}>
										{blockedReason}
									</span>
								)}
							</div>
						);
					})}
				</div>

				<div
					style={{
						display: 'flex',
						justifyContent: 'flex-end',
						alignItems: 'center',
						gap: 8,
					}}
				>
					<Button variant="ghost" onClick={onClose}>
						cancel
					</Button>

					{confirming ? (
						<Button
							onClick={() => {
								onRedact(selectedIds);
								onClose();
							}}
							style={{color: GUI_THEME.red, borderColor: GUI_THEME.red}}
						>
							{`confirm: redact ${selectedNames.join(', ')}`}
						</Button>
					) : (
						<Button
							disabled={selectedIds.length === 0}
							onClick={() => setConfirming(true)}
							style={
								selectedIds.length > 0 ? {color: GUI_THEME.red} : undefined
							}
						>
							{`redact ${selectedIds.length || ''}`.trim()}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
};
