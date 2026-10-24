import {GuiState} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {SyncStatus} from '../lib/gui-sync-statusmodel';
import {Button} from './Button';
import {IconButton} from './IconButton';
import {IconGear} from './IconGear';
import {CommandPaletteHint} from './CommandPaletteHint';
import {Panel} from './Panel';
import {User} from './User';
import {EPIQ_VERSION} from '../../../version.js';
import {VersionBadge} from './VersionBadge';

type HeaderProps = {
	state: GuiState | null;
	// 'connecting' is the first socket of a page load, which is not a fault and
	// says nothing; the rest are.
	connection: 'connected' | 'connecting' | 'reconnecting' | 'lost';
	onReconnect: () => void;
	scrubbing: boolean;
	syncStatus: SyncStatus;
	onOpenCommands: () => void;
	// The board switcher, placed here rather than over the columns: it names
	// what everything below is showing, the timeline included, and this is the
	// one row that outlives every panel and collapse below it.
	board: React.ReactNode;
	// What the whole app is doing, in the bar's middle: the follow notice.
	// While there is one, the bar's top edge carries the accent too.
	notice?: React.ReactNode;
	// Toggles the settings panel. The ref is the panel's, which must not take
	// a click here for a click outside.
	settings: {
		open: boolean;
		onToggle: () => void;
		ref: React.RefObject<HTMLSpanElement | null>;
	};
	update: React.ComponentProps<typeof VersionBadge>['update'];
};

export const Header = ({
	state,
	connection,
	onReconnect,
	scrubbing,
	syncStatus,
	onOpenCommands,
	board,
	notice,
	settings,
	update,
}: HeaderProps) => {
	const syncColor =
		syncStatus.status === 'synced'
			? GUI_THEME.green
			: syncStatus.status === 'failed'
			? GUI_THEME.red
			: syncStatus.status === 'offline'
			? GUI_THEME.dim
			: GUI_THEME.accent;

	// The dot's whole account of itself, since nothing beside it says this any
	// more. A failure keeps carrying its git output, which is the one thing
	// here that was never going to fit in the topbar.
	const syncTitle =
		connection !== 'connected'
			? 'Not connected'
			: syncStatus.status === 'failed'
			? `Sync failed — ${syncStatus.msg}`
			: syncStatus.msg;

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
				// The app's live edge while it moves on its own: drawn in, not
				// added, so the bar keeps its height and nothing below it moves.
				boxShadow: notice ? `inset 0 1px 0 ${GUI_THEME.accent}` : undefined,
			}}
		>
			<div
				style={{
					height: '100%',
					width: '100%',
					// Two equal sides around the middle, so a notice sits at the
					// centre while both fit; a side that needs more takes it,
					// pushing the notice over rather than running into it.
					display: 'grid',
					// The middle may shrink, its sentence cut, before the sides do.
					gridTemplateColumns: '1fr minmax(0, auto) 1fr',
					alignItems: 'center',
					columnGap: 24,
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

					{board}
				</div>

				<div style={{minWidth: 0}}>{notice}</div>

				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'flex-end',
						gap: 24,
					}}
				>
					<CommandPaletteHint onOpen={onOpenCommands} />

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

						{/* The colour is the whole message, so the word beside it only
						    repeated in text what the dot already said — and a failure's
						    git output never fitted there anyway. The hit area is a
						    button's rather than the dot's own, since the state is now
						    only readable by hovering it. */}
						<span
							data-testid="sync-dot"
							title={syncTitle}
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								padding: '5px 7px',
							}}
						>
							{/* Four, as the ticket that dropped the label asked for: a
							    marker, not a light. At six it was the loudest thing in a
							    bar of 11px grey type, which is the opposite of what
							    dropping the word was for. What makes a dot this small
							    usable is the hit area around it, and that is unchanged. */}
							<span
								style={{
									width: 4,
									height: 4,
									borderRadius: 999,
									background:
										connection === 'connected' ? syncColor : GUI_THEME.dim,
								}}
							/>
						</span>

						<span style={{color: GUI_THEME.dim}}>|</span>

						{connection === 'connected' ? (
							<span style={{color: GUI_THEME.dim}}>Connected</span>
						) : connection === 'connecting' ? (
							<span style={{color: GUI_THEME.dim}}>Connecting…</span>
						) : connection === 'reconnecting' ? (
							<span
								data-testid="reconnecting"
								style={{color: GUI_THEME.accent}}
							>
								Reconnecting…
							</span>
						) : (
							// The button alone says it: an offer to reconnect only makes
							// sense if the connection is gone.
							<Button
								data-testid="connection-lost"
								variant="ghost"
								onClick={onReconnect}
								style={{color: GUI_THEME.red, fontSize: 10}}
							>
								Reconnect
							</Button>
						)}

						<span style={{color: GUI_THEME.dim}}>|</span>
						<VersionBadge current={EPIQ_VERSION} update={update} />
					</div>

					{/* The one way into settings: the viewer's own avatar, which says
					    who the board takes them for as well, and a gear only where no
					    identity is set yet to draw one. Filled while the panel is open. */}
					<span ref={settings.ref} style={{display: 'inline-flex'}}>
						{state?.user ? (
							<button
								data-testid="open-settings"
								onClick={settings.onToggle}
								aria-label="Settings"
								aria-pressed={settings.open}
								aria-expanded={settings.open}
								aria-controls="settings-panel"
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
								<User user={state.user} filled={settings.open} />
							</button>
						) : (
							<IconButton
								title="Settings"
								testId="open-settings"
								pressed={settings.open}
								aria-expanded={settings.open}
								aria-controls="settings-panel"
								onClick={settings.onToggle}
							>
								<IconGear />
							</IconButton>
						)}
					</span>
				</div>
			</div>
		</Panel>
	);
};
