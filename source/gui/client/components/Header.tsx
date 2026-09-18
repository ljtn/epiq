import {useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {GuiState} from '../lib/gui-state.model';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {GUI_THEME} from '../lib/gui-theme';
import {SyncStatus} from '../lib/gui-sync-statusmodel';
import {Button} from './Button';
import {CommandPaletteHint} from './CommandPaletteHint';
import {Panel} from './Panel';
import {User} from './User';
import {EPIQ_VERSION} from '../../../version.js';

type HeaderProps = {
	state: GuiState | null;
	// 'connecting' is the first socket of a page load, which is not a fault and
	// says nothing; the rest are.
	connection: 'connected' | 'connecting' | 'reconnecting' | 'lost';
	onReconnect: () => void;
	scrubbing: boolean;
	syncStatus: SyncStatus;
	onOpenCommands: () => void;
	identity: {
		open: boolean;
		onToggle: () => void;
		onDismiss: () => void;
		panel: React.ReactNode;
	};
};

export const Header = ({
	state,
	connection,
	onReconnect,
	scrubbing,
	syncStatus,
	onOpenCommands,
	identity,
}: HeaderProps) => {
	const panelRef = useRef<HTMLDivElement | null>(null);
	// The panel is portalled out of this header, so it is not a descendant of the
	// trigger and has to be named as inside explicitly.
	const identityRef = useDismissOnOutsideClick(
		identity.open,
		identity.onDismiss,
		[panelRef],
	);

	// Anchored to the avatar rather than positioned inside it: `Panel` clips its
	// children to contain its own glow, so a panel absolutely positioned in here
	// is cut off at the header's edge.
	const [anchor, setAnchor] = useState<{right: number; top: number} | null>(
		null,
	);

	useLayoutEffect(() => {
		if (!identity.open) return;

		const place = () => {
			const box = identityRef.current?.getBoundingClientRect();
			if (!box) return;

			setAnchor({
				right: Math.max(8, window.innerWidth - box.right),
				top: box.bottom + 8,
			});
		};

		place();
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);

		return () => {
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
		};
	}, [identity.open, identityRef]);

	const syncColor =
		syncStatus.status === 'synced'
			? GUI_THEME.green
			: syncStatus.status === 'failed'
			? GUI_THEME.red
			: syncStatus.status === 'offline'
			? GUI_THEME.dim
			: GUI_THEME.accent;

	// Failures can carry multi-line git output — never render that in the
	// topbar. Show a short label and keep the details in the hover tooltip.
	const syncLabel =
		syncStatus.status === 'failed'
			? 'sync failed'
			: syncStatus.msg.toLowerCase();

	return (
		<Panel
			as="header"
			borderRadius={0}
			borderColor={GUI_THEME.line}
			glowOpacity={0.08}
			style={{
				height: 56,
				padding: '0 30px',
				borderLeft: 'none',
				borderRight: 'none',
				borderTop: 'none',
			}}
		>
			<div
				style={{
					height: '100%',
					width: '100%',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
				}}
			>
				<div style={{display: 'flex', alignItems: 'center', gap: 14}}>
					<div
						style={{
							color: GUI_THEME.accent,
							fontSize: 12,
							fontWeight: 700,
						}}
					>
						:epiq
					</div>

					<CommandPaletteHint onOpen={onOpenCommands} />
				</div>

				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 24,
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 12,
							fontSize: 11,
							whiteSpace: 'nowrap',
						}}
					>
						{scrubbing && (
							<>
								<span style={{color: GUI_THEME.accent, fontWeight: 700}}>
									Read-only
								</span>
								<span style={{color: GUI_THEME.dim}}>|</span>
							</>
						)}

						<span
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 12,
								justifyContent: 'flex-end',
							}}
						>
							<span
								title={
									syncStatus.status === 'failed' ? syncStatus.msg : undefined
								}
								style={{
									color: GUI_THEME.dim,
									maxWidth: 220,
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
									textAlign: 'right',
								}}
							>
								{connection === 'connected' ? syncLabel : '-'}
							</span>

							<span
								style={{
									color: connection === 'connected' ? syncColor : GUI_THEME.dim,
									fontSize: 4,
								}}
							>
								●
							</span>
						</span>

						<span style={{color: GUI_THEME.dim}}>|</span>

						{connection === 'connected' ? (
							<span style={{color: GUI_THEME.dim}}>connected</span>
						) : connection === 'connecting' ? (
							<span style={{color: GUI_THEME.dim}}>connecting…</span>
						) : connection === 'reconnecting' ? (
							<span
								data-testid="reconnecting"
								style={{color: GUI_THEME.accent}}
							>
								reconnecting…
							</span>
						) : (
							// The button alone says it: an offer to reconnect only makes
							// sense if the connection is gone.
							<Button
								data-testid="connection-lost"
								variant="ghost"
								onClick={onReconnect}
								title="Not connected — reconnect now"
								style={{color: GUI_THEME.red, fontSize: 10}}
							>
								reconnect
							</Button>
						)}

						<span style={{color: GUI_THEME.dim}}>|</span>
						<span
							style={{
								color: GUI_THEME.dim,
							}}
						>
							{'v' + EPIQ_VERSION}
						</span>
					</div>

					{state?.user && (
						// The avatar was the only thing in the GUI that named the viewer,
						// and it did nothing. It is the obvious place to ask who the board
						// thinks you are.
						<div ref={identityRef} style={{position: 'relative'}}>
							<button
								onClick={identity.onToggle}
								aria-label="Your identity on this board"
								style={{
									background: 'transparent',
									border: 'none',
									cursor: 'pointer',
									display: 'flex',
									padding: 0,
								}}
							>
								{/* `User` renders its own `title`, which covers the button and
								    wins every hover, so a title here would never be seen. */}
								<User user={state.user} />
							</button>
							{identity.open &&
								anchor &&
								createPortal(
									<div
										ref={panelRef}
										style={{
											position: 'fixed',
											right: anchor.right,
											top: anchor.top,
											zIndex: 60,
											// The height is capped here, where the distance from
											// the top of the window is known, but the scrolling
											// belongs to the panel: a panel scrolled from outside
											// loses its own bottom edge over the fold and reads as
											// cut off rather than as a list with more in it.
											maxHeight: `calc(100vh - ${anchor.top + 16}px)`,
											display: 'flex',
										}}
									>
										{identity.panel}
									</div>,
									document.body,
								)}
						</div>
					)}
				</div>
			</div>
		</Panel>
	);
};
