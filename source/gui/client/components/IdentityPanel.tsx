import {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {ContributorEmailsState} from '../lib/use-contributor-emails';
import {actorDisplay} from '../lib/agent-identity';

// Where somebody goes when the board is calling their commits by the wrong
// name, or by no name at all. Before this there was nowhere: an unresolved
// commit showed a raw git string and nothing said why, or what would fix it.

const row: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: 8,
	padding: '6px 0',
	borderBottom: `1px solid ${GUI_THEME.line}`,
};

const label: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: 11,
	textTransform: 'uppercase',
	letterSpacing: 0.4,
};

export const IdentityPanel = ({
	state,
	me,
	onLink,
	onUnlink,
}: {
	state: ContributorEmailsState;
	me: {id: string; name: string} | null;
	onLink: (email: string) => void;
	onUnlink: (email: string) => void;
}) => {
	const [draft, setDraft] = useState('');

	const mine = new Set(state.data?.mine ?? []);
	const contested = (state.data?.emails ?? []).filter(claim => claim.contested);

	const claim = () => {
		const email = draft.trim();
		if (!email) return;
		onLink(email);
		setDraft('');
	};

	return (
		<div
			style={{
				background: GUI_THEME.panel,
				border: `1px solid ${GUI_THEME.edge}`,
				borderRadius: 6,
				padding: 12,
				width: 420,
				color: GUI_THEME.primary,
				fontSize: 12,
			}}
		>
			<div style={label}>You on this board</div>
			<div style={{...row, color: GUI_THEME.primarySoft}}>
				{me ? actorDisplay(me.name).label : 'Not configured'}
			</div>

			<div style={{...label, marginTop: 12}}>Your git addresses</div>
			{mine.size === 0 ? (
				<div style={{...row, color: GUI_THEME.dim}}>
					None linked yet. Your commits show the name git signed them with.
				</div>
			) : (
				[...mine].map(email => (
					<div key={email} style={row}>
						<span style={{flex: 1}}>{email}</span>
						<button
							onClick={() => onUnlink(email)}
							style={{
								background: 'transparent',
								border: `1px solid ${GUI_THEME.line}`,
								borderRadius: 4,
								color: GUI_THEME.dim2,
								cursor: 'pointer',
								fontSize: 11,
								padding: '2px 6px',
							}}
							// Says what it costs: the log is never rewritten, so this stops
							// the address resolving and leaves the event in place.
							title="Stop this address resolving to you. The event stays in the log."
						>
							Unlink
						</button>
					</div>
				))
			)}

			{contested.length > 0 && (
				<>
					<div style={{...label, marginTop: 12, color: GUI_THEME.amber}}>
						Claimed by more than one person
					</div>
					{contested.map(item => (
						<div key={item.email} style={{...row, display: 'block'}}>
							<div>{item.email}</div>
							<div style={{color: GUI_THEME.dim, marginTop: 2}}>
								{/* Named, because this is the one state the board would
								    otherwise show as a plain unresolved commit — and it is
								    reachable with nobody doing anything wrong, when two
								    people share one git user.email. */}
								{item.claimants
									.map(person => actorDisplay(person.name).label)
									.join(' and ')}{' '}
								both claim it, so these commits resolve to neither.
							</div>
						</div>
					))}
				</>
			)}

			<div style={{...label, marginTop: 12}}>Claim an address</div>
			<div style={{display: 'flex', gap: 6, paddingTop: 6}}>
				<input
					value={draft}
					onChange={event => setDraft(event.target.value)}
					onKeyDown={event => event.key === 'Enter' && claim()}
					placeholder="you@example.com"
					style={{
						flex: 1,
						background: GUI_THEME.panel2,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 4,
						color: GUI_THEME.primary,
						fontSize: 12,
						padding: '4px 6px',
					}}
				/>
				<button
					onClick={claim}
					style={{
						background: GUI_THEME.panel2,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 4,
						color: GUI_THEME.accent,
						cursor: 'pointer',
						fontSize: 12,
						padding: '4px 10px',
					}}
				>
					Link
				</button>
			</div>
			<div style={{color: GUI_THEME.dim, paddingTop: 6, lineHeight: 1.5}}>
				Every commit by that address becomes yours, back to the first one. The
				link is permanent and reaches every clone; unlinking stops it resolving
				but leaves the record.
			</div>

			{state.lastAction && (
				<div
					style={{
						color: state.lastAction.ok ? GUI_THEME.green : GUI_THEME.red,
						paddingTop: 8,
					}}
				>
					{state.lastAction.message}
				</div>
			)}
		</div>
	);
};
