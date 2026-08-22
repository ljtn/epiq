import {GuiState} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {Panel} from './Panel';
import {User} from './User';
import {EPIQ_VERSION} from '../../../version.js';

type HeaderProps = {
	state: GuiState | null;
	connected: boolean;
	// Still trying on its own; once that is spent the button takes over.
	reconnecting: boolean;
	onReconnect: () => void;
	scrubbing: boolean;
	syncStatus: {
		status: 'synced' | 'failed' | 'syncing';
		msg: string;
	};
};

export const Header = ({
	state,
	connected,
	reconnecting,
	onReconnect,
	scrubbing,
	syncStatus,
}: HeaderProps) => {
	const syncColor =
		syncStatus.status === 'synced'
			? GUI_THEME.green
			: syncStatus.status === 'failed'
			? GUI_THEME.red
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
								{connected ? syncLabel : '-'}
							</span>

							<span
								style={{
									color: connected ? syncColor : GUI_THEME.dim,
									fontSize: 4,
								}}
							>
								●
							</span>
						</span>

						<span style={{color: GUI_THEME.dim}}>|</span>

						{connected ? (
							<span style={{color: GUI_THEME.dim}}>connected</span>
						) : reconnecting ? (
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
