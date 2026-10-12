import {useState} from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {Button} from './Button';
import {Input} from './FormPrimitives';
import {META, ROW, SECTION_HEADING} from '../lib/identity-panel.style';
import {useArmed} from '../lib/use-armed';
import {ContributorEmailsState} from '../lib/use-contributor-emails';
import {actorDisplay} from '../lib/agent-identity';

// Where somebody goes when the board is calling their commits by the wrong
// name, or by no name at all: a section of the settings panel. Before this there was nowhere: an unresolved
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

// The address itself, one step under the identity and well over its note.
const address: React.CSSProperties = {
	fontSize: TEXT.prose,
	overflowWrap: 'anywhere',
};

const name = (person: {name: string}) => actorDisplay(person.name).label;

// How many unclaimed addresses show before the rest wait behind a button.
const SHOWN = 8;

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
		<div style={META}>
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
			<div style={SECTION_HEADING}>{title}</div>
			{rows.map((row, index) => (
				<AddressRow key={row.email} row={row} last={index === rows.length - 1}>
					{children(row)}
				</AddressRow>
			))}
		</>
	);
};

// One address. Yours in the panel's own text; the rest held back as a list
// is, and brought up under the pointer — still readable held back, since the
// list is what somebody came here to read through.
const AddressRow = ({
	row,
	last,
	children,
}: {
	row: Row;
	last: boolean;
	children: React.ReactNode;
}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<div
			data-testid={`identity-row-${row.email}`}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				...ROW,
				alignItems: 'flex-start',
				...(last ? {borderBottom: 'none'} : {}),
			}}
		>
			<div
				style={{
					flex: 1,
					minWidth: 0,
					// Held back to under half, both lines in the dim; under the
					// pointer the note comes up to the dim and the address to a
					// grey a little over half of the text colour — lit, not lit up.
					opacity: row.mine || hovered ? 1 : 0.45,
					transition: 'opacity 120ms ease',
				}}
			>
				<div
					style={{
						...address,
						color: row.mine
							? GUI_THEME.primary
							: hovered
							? `${GUI_THEME.primary}8c`
							: GUI_THEME.dim,
						transition: 'color 120ms ease',
					}}
				>
					{row.email}
				</div>
				<Note row={row} />
			</div>
			{children}
		</div>
	);
};

export const IdentityAddresses = ({
	state,
	onLink,
	onUnlink,
}: {
	state: ContributorEmailsState;
	onLink: (email: string) => void;
	onUnlink: (email: string) => void;
}) => {
	const rows = rowsFrom(state);
	// A claim is permanent and reaches every clone, so it takes two clicks:
	// the button becomes "confirm" and commits on the second.
	const claim = useArmed<string>();
	const claimButton = (row: Row, label: string, title: string) => {
		const armed = claim.armed === row.email;

		return (
			<Button
				variant={armed ? 'default' : 'primary'}
				tint={armed ? GUI_THEME.accent : undefined}
				held={armed}
				title={
					armed
						? 'Click again to claim it. Permanent, and it reaches every clone.'
						: title
				}
				onBlur={claim.disarm}
				onClick={() => {
					if (claim.press(row.email)) onLink(row.email);
				}}
			>
				{armed ? 'confirm' : label}
			</Button>
		);
	};

	// Claimed means claimed by anybody, not only by the viewer. An address
	// somebody else holds is neither theirs to unlink nor free to take, and
	// leaving it out of both sections would hide where their commits went.
	const claimed = rows.filter(row => row.claimants.length > 0);
	const free = rows.filter(row => row.claimants.length === 0);

	// Every one of them, never a subset by likeness. Which address somebody came
	// to claim is not something this panel can guess: an old job's is unlike
	// anything they are called now, so a rule that hid the unlikely ones would
	// hide exactly that. On a long history the list is long, so it is found
	// through rather than read through: a filter on the address or the name,
	// and past a handful the rest wait behind one button.
	const [query, setQuery] = useState('');
	const [showAll, setShowAll] = useState(false);
	const needle = query.trim().toLowerCase();
	const matches = (row: Row) =>
		needle === '' ||
		row.email.toLowerCase().includes(needle) ||
		row.names.some(name => name.toLowerCase().includes(needle));
	const long = rows.length > SHOWN;
	const claimedShown = claimed.filter(matches);
	const freeMatching = free.filter(matches);
	const capped = long && needle === '' && !showAll;
	const unclaimed = capped ? freeMatching.slice(0, SHOWN) : freeMatching;
	const hidden = freeMatching.length - unclaimed.length;

	return (
		<div data-testid="identity-addresses" style={{paddingTop: 2}}>
			{state.lastError && (
				// Only a failure. A claim that worked shows in the list itself, and
				// nothing else in this GUI reports its own successes back.
				<div style={{...META, paddingTop: 10, color: GUI_THEME.red}}>
					{state.lastError}
				</div>
			)}

			<div>
				{long && (
					<Input
						data-testid="identity-filter"
						aria-label="Filter addresses"
						placeholder="filter by address or name"
						value={query}
						onChange={event => setQuery(event.target.value)}
						onKeyDown={event => {
							// The field's, not the panel's: clear it before closing.
							if (event.key === 'Escape' && query) {
								event.stopPropagation();
								setQuery('');
							}
						}}
						style={{
							marginTop: 14,
							borderRadius: 6,
							padding: '6px 10px',
							fontSize: TEXT.prose,
						}}
					/>
				)}

				{state.scanError ? (
					// Not the empty state: claiming from this list is the only way to
					// link an address, so a history that could not be read has to say
					// so rather than look like one with nothing left in it.
					<div style={{...META, paddingTop: 16, color: GUI_THEME.red}}>
						{state.scanError}
					</div>
				) : (
					<>
						<Section title="Claimed git addresses" rows={claimedShown}>
							{row =>
								row.mine ? (
									<Button
										onClick={() => onUnlink(row.email)}
										title="Stop this address resolving to you. The record of the claim stays in the log."
									>
										Unclaim
									</Button>
								) : (
									// Offered even though somebody else holds it, and named for
									// what it does rather than "This is me". Without it,
									// unclaiming an address a colleague also claims was a one-way
									// door: the row moved up here and offered nothing. It is also
									// the only answer to somebody claiming an address of yours —
									// co-claiming is what stops it resolving to them.
									claimButton(
										row,
										'Claim too',
										'Claim this address as well. While two people claim it, commits by it resolve to neither of you.',
									)
								)
							}
						</Section>

						<Section title="Unclaimed" rows={unclaimed}>
							{row =>
								claimButton(
									row,
									'This is me',
									'Every commit by this address becomes yours, back to the first one. Permanent, and it reaches every clone.',
								)
							}
						</Section>

						{hidden > 0 && (
							<div style={{paddingTop: 10}}>
								<Button variant="ghost" onClick={() => setShowAll(true)}>
									{`${hidden} more address${hidden === 1 ? '' : 'es'}`}
								</Button>
							</div>
						)}

						{claimedShown.length === 0 && unclaimed.length === 0 && (
							<div style={{...META, paddingTop: 14}}>
								{needle
									? 'No address matches.'
									: 'No addresses in this repository’s history yet.'}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
};
