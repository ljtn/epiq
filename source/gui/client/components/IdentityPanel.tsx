import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {CODE_FONT} from '../lib/code-text.style';
import {ContributorEmailsState} from '../lib/use-contributor-emails';
import {actorDisplay} from '../lib/agent-identity';

// Where somebody goes when the board is calling their commits by the wrong
// name, or by no name at all. Before this there was nowhere: an unresolved
// commit showed a raw git string and nothing said why, or what would fix it.
//
// One list, not a section per state. An address was appearing in three of them
// at once — under the addresses you hold, under the contested ones, and under
// what git signs your commits as — which made a panel about four addresses read
// as a panel about nine. Each row now carries its own state instead.

type Row = {
	email: string;
	/** Claimed by the viewer. Decides which action the row offers. */
	mine: boolean;
	/** Everyone claiming it. More than one and it resolves to nobody. */
	claimants: string[];
	/** What git in this repository is configured to sign commits as. */
	signsHere: boolean;
	/** Whether anything about this address matches what the viewer is called. */
	looksLikeYours: boolean;
	commits: number | null;
	names: string[];
};

// One section heading, as quiet as a heading can be and still divide.
const label: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: TEXT.label,
	textTransform: 'uppercase',
	letterSpacing: 0.6,
};

// Who you are. The brightest thing here, not the biggest: everything in this
// GUI is one size, and hierarchy is carried by how loud a thing is rather than
// how large.
const identity: React.CSSProperties = {
	color: GUI_THEME.primary,
	fontSize: TEXT.ui,
};

// The address itself, one step under the identity and well over its note.
const address: React.CSSProperties = {
	fontSize: TEXT.ui,
	overflowWrap: 'anywhere',
};

// The note under an address: what git does with it, who else claims it, how
// many commits it carries. Absent where there is nothing to say.
const meta: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: TEXT.meta,
	marginTop: 4,
	lineHeight: 1.5,
};

// Every button in here is the same object, so the panel reads as one surface.
const action: React.CSSProperties = {
	background: 'transparent',
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 4,
	cursor: 'pointer',
	fontFamily: CODE_FONT,
	fontSize: TEXT.meta,
	padding: '3px 8px',
	whiteSpace: 'nowrap',
};

const name = (person: {name: string}) => actorDisplay(person.name).label;

/**
 * Every address the panel knows about, merged into one row each.
 *
 * Yours first, then whatever git signs commits as here, then the busiest. That
 * ordering puts the two rows somebody opened this panel to act on at the top
 * without giving either a heading of its own.
 */
const rowsFrom = (state: ContributorEmailsState): Row[] => {
	const mine = new Set(state.data?.mine ?? []);
	const git = state.data?.git ?? null;
	const byEmail = new Map<string, Row>();

	const at = (email: string): Row => {
		const existing = byEmail.get(email);
		if (existing) return existing;

		const fresh: Row = {
			email,
			mine: mine.has(email),
			claimants: [],
			signsHere: git?.email === email,
			looksLikeYours: false,
			commits: null,
			names: [],
		};
		byEmail.set(email, fresh);
		return fresh;
	};

	for (const email of mine) at(email);
	if (git) at(git.email);

	for (const claim of state.data?.emails ?? []) {
		at(claim.email).claimants = claim.claimants.map(name);
	}

	for (const candidate of state.candidates) {
		const row = at(candidate.email);
		row.commits = candidate.commits;
		row.names = candidate.names;
		row.looksLikeYours = candidate.looksLikeYours;
	}

	return [...byEmail.values()].sort((a, b) => {
		if (a.mine !== b.mine) return a.mine ? -1 : 1;
		if (a.signsHere !== b.signsHere) return a.signsHere ? -1 : 1;
		return (b.commits ?? 0) - (a.commits ?? 0);
	});
};

const Note = ({row}: {row: Row}) => {
	const parts: React.ReactNode[] = [];

	if (row.signsHere) parts.push('your git identity here');

	// Contested is the one state the board would otherwise show as a plain
	// unresolved commit, and it is reachable with nobody doing anything wrong:
	// two people sharing one git user.email.
	if (row.claimants.length > 1) {
		// A label rather than a colour. The state matters, but colouring it made
		// the warning the loudest thing in a panel whose subject is the person
		// reading it, and every other marker in this GUI is a quiet uppercase word.
		parts.push(
			<span key="contested">
				<span style={{letterSpacing: 0.6}}>CONTESTED:</span> claimed by{' '}
				{row.claimants.join(' and ')}, resolves to nobody
			</span>,
		);
	} else if (!row.mine && row.claimants.length === 1) {
		parts.push(`claimed by ${row.claimants[0]}`);
	}

	if (row.commits !== null) {
		// The name only where it is news. On the address git is configured with it
		// is whatever the viewer already calls themselves, and saying so pushed
		// every one of these notes onto a second line.
		const as = row.signsHere ? '' : ` as ${row.names.join(', ') || 'unknown'}`;

		parts.push(`${row.commits} commit${row.commits === 1 ? '' : 's'}${as}`);
	}

	if (parts.length === 0) return null;

	return (
		<div style={meta}>
			{parts.map((part, index) => (
				<span key={index}>
					{index > 0 ? ' · ' : ''}
					{part}
				</span>
			))}
		</div>
	);
};

const Section = ({
	title,
	rows,
	children,
}: {
	title: string;
	rows: Row[];
	children: (row: Row) => React.ReactNode;
}) => {
	if (rows.length === 0) return null;

	return (
		<>
			<div style={{...label, paddingTop: 18, paddingBottom: 8}}>{title}</div>
			{rows.map(row => (
				<div
					key={row.email}
					style={{
						display: 'flex',
						alignItems: 'flex-start',
						gap: 12,
						// A card rather than a rule between rows. An address and its note
						// are one object, and a line between them only says where one
						// stops; a surface says which parts belong together.
						background: GUI_THEME.panel2,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 6,
						padding: '10px 12px',
						marginBottom: 8,
					}}
				>
					<div style={{flex: 1, minWidth: 0}}>
						<div
							style={{
								...address,
								color: row.mine ? GUI_THEME.primary : GUI_THEME.dim2,
							}}
						>
							{row.email}
						</div>
						<Note row={row} />
					</div>
					{children(row)}
				</div>
			))}
		</>
	);
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
	const rows = rowsFrom(state);

	// Claimed means claimed by anybody, not only by the viewer. An address
	// somebody else holds is neither theirs to unlink nor free to take, and
	// leaving it out of both sections would hide where their commits went.
	const claimed = rows.filter(row => row.claimants.length > 0);
	const free = rows.filter(row => row.claimants.length === 0);

	// Every one of them, never a subset. Which address somebody came to claim is
	// not something this panel can guess: an old job's is unlike anything they
	// are called now, so a rule that hid the unlikely ones would hide exactly
	// that. The list is as long as the history is wide, and the panel scrolls.
	const unclaimed = free;

	return (
		<div
			data-testid="identity-panel"
			style={{
				background: GUI_THEME.panel,
				border: `1px solid ${GUI_THEME.edge}`,
				borderRadius: 6,
				padding: '16px 18px 14px',
				width: 440,
				color: GUI_THEME.primary,
				// UI chrome, so monospace like every other label, button and tag in
				// the GUI. Without naming one this fell back to the browser's serif
				// and the panel read as a different application.
				fontFamily: CODE_FONT,
				fontSize: TEXT.ui,
			}}
		>
			<div style={{display: 'flex', alignItems: 'baseline', gap: 9}}>
				<span style={identity}>
					{me ? actorDisplay(me.name).label : 'Not configured'}
				</span>
				<span style={label}>on this board</span>
			</div>

			{state.lastError && (
				// Only a failure. A claim that worked shows in the list itself, and
				// nothing else in this GUI reports its own successes back.
				<div style={{...meta, paddingTop: 10, color: GUI_THEME.red}}>
					{state.lastError}
				</div>
			)}

			{state.scanError ? (
				// Not the empty state: claiming from this list is the only way to
				// link an address, so a history that could not be read has to say so
				// rather than look like one with nothing left in it.
				<div style={{...meta, paddingTop: 16, color: GUI_THEME.red}}>
					{state.scanError}
				</div>
			) : (
				<>
					<Section title="Claimed git addresses" rows={claimed}>
						{row =>
							row.mine ? (
								<button
									onClick={() => onUnlink(row.email)}
									style={{...action, color: GUI_THEME.dim2}}
									title="Stop this address resolving to you. The record of the claim stays in the log."
								>
									Unclaim
								</button>
							) : (
								// Offered even though somebody else holds it, and named for
								// what it does rather than "This is me". Without it,
								// unclaiming an address a colleague also claims was a one-way
								// door: the row moved up here and offered nothing. It is also
								// the only answer to somebody claiming an address of yours —
								// co-claiming is what stops it resolving to them.
								<button
									onClick={() => onLink(row.email)}
									style={{...action, color: GUI_THEME.dim2}}
									title="Claim this address as well. While two people claim it, commits by it resolve to neither of you."
								>
									Claim too
								</button>
							)
						}
					</Section>

					<Section title="Unclaimed" rows={unclaimed}>
						{row => (
							<button
								onClick={() => onLink(row.email)}
								style={{...action, color: GUI_THEME.accent}}
								title="Every commit by this address becomes yours, back to the first one. Permanent, and it reaches every clone."
							>
								This is me
							</button>
						)}
					</Section>

					{claimed.length === 0 && unclaimed.length === 0 && (
						<div style={{...meta, paddingTop: 16}}>
							No addresses in this repository’s history yet.
						</div>
					)}
				</>
			)}
		</div>
	);
};
