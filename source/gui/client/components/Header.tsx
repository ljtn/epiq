import {GuiState} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {SyncStatus} from '../lib/gui-sync-statusmodel';
import {Button} from './Button';
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
};

export const Header = ({
	state,
	connection,
	onReconnect,
	scrubbing,
	syncStatus,
}: HeaderProps) => {
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
		syncStatus.status === 'failed' ? '-' : syncStatus.msg.toLowerCase();

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
				<div
					style={{
						color: GUI_THEME.accent,
						fontSize: 12,
						fontWeight: 700,
					}}
				>
					:epiq
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

					{state?.user && <User user={state.user} />}
				</div>
			</div>
		</Panel>
	);
};
