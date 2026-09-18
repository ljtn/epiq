import {useState} from 'react';
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

const label: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: TEXT.label,
	textTransform: 'uppercase',
	letterSpacing: 0.4,
};

// The note under an address: what git does with it, who else claims it, how
// many commits it carries. Absent where there is nothing to say.
const meta: React.CSSProperties = {
	color: GUI_THEME.dim,
	fontSize: TEXT.meta,
	marginTop: 3,
	lineHeight: 1.45,
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

	if (row.signsHere) parts.push('git signs your commits with this');

	// Contested is the one state the board would otherwise show as a plain
	// unresolved commit, and it is reachable with nobody doing anything wrong:
	// two people sharing one git user.email.
	if (row.claimants.length > 1) {
		parts.push(
			<span key="contested" style={{color: GUI_THEME.amber}}>
				claimed by {row.claimants.join(' and ')}, so it resolves to nobody
			</span>,
		);
	} else if (!row.mine && row.claimants.length === 1) {
		parts.push(`claimed by ${row.claimants[0]}`);
	}

	if (row.commits !== null) {
		parts.push(
			`${row.commits} commit${row.commits === 1 ? '' : 's'} as ${
				row.names.join(', ') || 'unknown'
			}`,
		);
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
	const [showAll, setShowAll] = useState(false);

	const rows = rowsFrom(state);

	// Held rows always show. Unclaimed ones are filtered to those that look like
	// the viewer's, so a busy repository does not open as a wall of colleagues'
	// addresses — but the rest stay one click away, because an address from a
	// job with a different name matches nothing and is exactly what somebody
	// opens this panel to fix.
	const alwaysShown = (row: Row) =>
		row.mine || row.claimants.length > 0 || row.signsHere || row.looksLikeYours;

	const hidden = rows.filter(row => !alwaysShown(row));
	const shown = showAll ? rows : rows.filter(alwaysShown);

	return (
		<div
			data-testid="identity-panel"
			style={{
				background: GUI_THEME.panel,
				border: `1px solid ${GUI_THEME.edge}`,
				borderRadius: 6,
				padding: 14,
				width: 400,
				color: GUI_THEME.primary,
				// UI chrome, so monospace like every other label, button and tag in
				// the GUI. Without naming one this fell back to the browser's serif
				// and the panel read as a different application.
				fontFamily: CODE_FONT,
				fontSize: TEXT.ui,
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'baseline',
					gap: 8,
					paddingBottom: 10,
					borderBottom: `1px solid ${GUI_THEME.line}`,
				}}
			>
				<span style={{color: GUI_THEME.primarySoft}}>
					{me ? actorDisplay(me.name).label : 'Not configured'}
				</span>
				<span style={{...label, marginTop: 0}}>on this board</span>
			</div>

			<div style={{...label, paddingTop: 12, paddingBottom: 2}}>
				Git addresses
			</div>

			{state.scanError ? (
				// Not the empty state: claiming from this list is the only way to
				// link an address, so a history that could not be read has to say so
				// rather than look like one with nothing left in it.
				<div style={{...meta, paddingTop: 4, color: GUI_THEME.red}}>
					{state.scanError}
				</div>
			) : shown.length === 0 ? (
				<div style={{...meta, paddingTop: 4}}>
					No addresses in this repository’s history yet.
				</div>
			) : (
				shown.map(row => (
					<div
						key={row.email}
						style={{
							display: 'flex',
							alignItems: 'flex-start',
							gap: 10,
							padding: '7px 0',
							borderBottom: `1px solid ${GUI_THEME.line}`,
						}}
					>
						<div style={{flex: 1, minWidth: 0}}>
							<div
								style={{
									color: row.mine ? GUI_THEME.primary : GUI_THEME.primarySoft,
									overflowWrap: 'anywhere',
								}}
							>
								{row.email}
							</div>
							<Note row={row} />
						</div>
						{row.mine && (
							<button
								onClick={() => onUnlink(row.email)}
								style={{...action, color: GUI_THEME.dim2}}
								// Says what it costs: the log is never rewritten, so this stops
								// the address resolving and leaves the event in place.
								title="Stop this address resolving to you. The event stays in the log."
							>
								Unlink
							</button>
						)}
						{/* Nothing offered on a row somebody else holds. Claiming it
						    would only make it contested, which is the state this panel
						    exists to explain rather than to help you create. */}
						{!row.mine && row.claimants.length === 0 && (
							<button
								onClick={() => onLink(row.email)}
								style={{...action, color: GUI_THEME.accent}}
								title="Every commit by this address becomes yours, back to the first one. Permanent, and it reaches every clone."
							>
								This is me
							</button>
						)}
					</div>
				))
			)}

			{hidden.length > 0 && !showAll && (
				<button
					onClick={() => setShowAll(true)}
					style={{
						...action,
						border: 'none',
						color: GUI_THEME.dim2,
						marginTop: 8,
						padding: 0,
					}}
				>
					{hidden.length} more address{hidden.length === 1 ? '' : 'es'} in this
					history
				</button>
			)}

			<div style={{...meta, paddingTop: 10}}>
				{/* No free-text box on purpose. You can only claim an address this
				    repository's history already holds, so a typo claims nothing and
				    there is no way to reach for one that was never yours. */}
				Claims are permanent and reach every clone.
			</div>

			{state.lastAction && (
				<div
					style={{
						...meta,
						color: state.lastAction.ok ? GUI_THEME.green : GUI_THEME.red,
						paddingTop: 6,
					}}
				>
					{state.lastAction.message}
				</div>
			)}
		</div>
	);
};
