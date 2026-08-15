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

// Lives in its own modal rather than inline in an issue's assignee picker.
// Clearing a name is workspace-wide and permanent, and a control sitting
// among per-issue chips reads as if it were scoped to that issue — the
// opposite of what it does. A separate view makes the reach obvious before
// anything is clicked.
export const RedactContributorsModal = ({
	contributors,
	onRedact,
	onClose,
}: Props) => {
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [confirming, setConfirming] = useState(false);

	// Everyone is listed, including those who can't be redacted: seeing that
	// a teammate is present but unavailable explains the rule better than
	// silently omitting them, which would just look like a missing name.
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
					Clears the selected names everywhere, on every board and for everyone.
					The contributor and all their assignments are kept — only the name is
					removed, and it cannot be restored.
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
						// The server refuses anyone who has authored events: their name
						// is written into every event they wrote, so clearing the
						// registry copy alone would remove nothing.
						//
						// Keyed on `hasAuthoredAnywhere`, not `isExternal`: the latter
						// is board-scoped, so a teammate who contributed on another
						// board looked clearable here and was then refused by the
						// server.
						const blockedReason = contributor.isRedacted
							? 'already cleared'
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
									title={blockedReason ?? 'Clear this name'}
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

					{/* Two steps, and the second one names who is affected — the whole
					    point of this view is that you can't do it without noticing. */}
					{confirming ? (
						<Button
							onClick={() => {
								onRedact(selectedIds);
								onClose();
							}}
							style={{color: GUI_THEME.red, borderColor: GUI_THEME.red}}
						>
							{`confirm: clear ${selectedNames.join(', ')}`}
						</Button>
					) : (
						<Button
							disabled={selectedIds.length === 0}
							onClick={() => setConfirming(true)}
							style={
								selectedIds.length > 0 ? {color: GUI_THEME.red} : undefined
							}
						>
							{`clear ${selectedIds.length || ''}`.trim()}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
};
