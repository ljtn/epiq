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
	const mine = new Set(state.data?.mine ?? []);
	const contested = (state.data?.emails ?? []).filter(claim => claim.contested);

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

			{state.data?.git && !state.data.git.linkedToMe && (
				<>
					<div style={{...label, marginTop: 12, color: GUI_THEME.amber}}>
						This repository signs your commits as
					</div>
					<div style={{...row, display: 'block'}}>
						<div>{state.data.git.email}</div>
						<div style={{color: GUI_THEME.dim, marginTop: 2}}>
							{state.data.git.heldByOthers.length > 0
								? `Already claimed by ${state.data.git.heldByOthers
										.map(person => actorDisplay(person.name).label)
										.join(' and ')}, so it was not linked to you. Your commits
										show as theirs.`
								: 'Not linked to you yet. It links itself on your next change to the board.'}
						</div>
					</div>
				</>
			)}

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

			<div style={{...label, marginTop: 12}}>
				Unclaimed addresses in this history
			</div>
			{state.candidates.length === 0 ? (
				<div style={{...row, color: GUI_THEME.dim}}>
					Nothing left to claim here.
				</div>
			) : (
				state.candidates.map(candidate => (
					<div key={candidate.email} style={row}>
						<div style={{flex: 1}}>
							<div>{candidate.email}</div>
							<div style={{color: GUI_THEME.dim, marginTop: 2}}>
								{candidate.commits} commit
								{candidate.commits === 1 ? '' : 's'} as{' '}
								{candidate.names.join(', ') || 'unknown'}
							</div>
						</div>
						<button
							onClick={() => onLink(candidate.email)}
							style={{
								background: 'transparent',
								border: `1px solid ${GUI_THEME.line}`,
								borderRadius: 4,
								color: GUI_THEME.accent,
								cursor: 'pointer',
								fontSize: 11,
								padding: '2px 8px',
							}}
							title="Every commit by this address becomes yours, back to the first one. Permanent, and it reaches every clone."
						>
							This is me
						</button>
					</div>
				))
			)}
			<div style={{color: GUI_THEME.dim, paddingTop: 6, lineHeight: 1.5}}>
				{/* No free-text box on purpose. You can only claim an address this
				    repository's history already holds, so a typo claims nothing and
				    there is no way to reach for one that was never yours. */}
				Only addresses that appear in this repository's history can be claimed.
				A claim is permanent and reaches every clone; unlinking stops it
				resolving but leaves the record.
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
