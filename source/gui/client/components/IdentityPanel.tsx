import {useState} from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {Button} from './Button';
import {Input} from './FormPrimitives';
import {META, ROW, SECTION_HEADING} from '../lib/card.style';
import {useArmed} from '../lib/use-armed';
import {ContributorEmailsState} from '../lib/use-contributor-emails';
import {actorDisplay} from '../lib/agent-identity';

// The settings section for addresses the board can't resolve to a person.
// One row per address, each carrying its own state.

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

/** One row per known address: yours, then git's signing address here, then the busiest. */
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

	if (row.signsHere) parts.push('Your Git identity here');

	// Contested: two people sharing one git user.email.
	if (row.claimants.length > 1) {
		// A quiet uppercase label, like every other marker here.
		parts.push(
			<span key="contested">
				<span style={{letterSpacing: 0.6}}>CONTESTED:</span> claimed by{' '}
				{row.claimants.join(' and ')}, resolves to nobody
			</span>,
		);
	} else if (!row.mine && row.claimants.length === 1) {
		parts.push(`Claimed by ${row.claimants[0]}`);
	}

	if (row.commits !== null) {
		// No name on git's own address: it is the viewer's.
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

// One address: yours at full strength, the rest dimmed until hovered.
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
					// Dimmed under half; hovered, lifted but not full.
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
				{armed ? 'Confirm' : label}
			</Button>
		);
	};

	// Claimed by anybody, so others' addresses still show where their commits went.
	const claimed = rows.filter(row => row.claimants.length > 0);
	const free = rows.filter(row => row.claimants.length === 0);

	// Every unclaimed address, never filtered by likeness: an old job's address
	// looks like nothing current. Found by a filter, the rest behind one button.
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
						placeholder="Filter by address or name"
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
					// Not the empty state: an unreadable history must say so.
					<div style={{...META, paddingTop: 16, color: GUI_THEME.red}}>
						{state.scanError}
					</div>
				) : (
					<>
						<Section title="Claimed Git addresses" rows={claimedShown}>
							{row =>
								row.mine ? (
									<Button
										onClick={() => onUnlink(row.email)}
										title="Stop this address resolving to you. The record of the claim stays in the log."
									>
										Unclaim
									</Button>
								) : (
									// Offered on addresses others hold too: co-claiming is the only way back from
									// an unclaim, or from someone claiming yours.
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
									? 'No address matches'
									: 'No addresses in this repository’s history yet'}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
};
