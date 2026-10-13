import {useEffect, useRef, useState} from 'react';
import {CODE_FONT} from '../lib/code-text.style';
import {GuiRepo, GuiRepoPreview} from '../lib/gui-state.model';
import {timeAgo} from '../lib/gui-format.helper';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {META, ROW} from '../lib/card.style';
import {useArmed} from '../lib/use-armed';
import {RepoConnectPayload, ReposState} from '../lib/use-repos';
import {repoUrlProblem, REPO_URL_FORMS} from '../../../lib/commits/repo-url.js';
import {formatBytes} from '../../../lib/utils/format-bytes.js';
import {Button} from './Button';
import {Chip} from './Chip';
import {Dropdown} from './Dropdown';
import {Input} from './FormPrimitives';
import {IconButton} from './IconButton';
import {IconLock} from './IconLock';
import {IconUnplug} from './IconUnplug';

// The repos the board reads commits from, as a section of the settings panel:
// its own first and locked, then the connected ones, then the row that connects
// another. Rows, not cards — the section is the card.

type Props = {
	state: ReposState;
	/** Stages a new repo and describes it; nothing is written. */
	onPreview: (payload: RepoConnectPayload) => void;
	onConfirm: () => void;
	onCancelPreview: () => void;
	/** A connected repo's options, written at once. */
	onChange: (payload: RepoConnectPayload) => void;
	onRemove: (repo: string) => void;
};

// Two of them and their gap fit the panel's row with room to spare; past it
// the second one wraps under the first.
const CONTROL_WIDTH = 154;
const LINE_GAP = 8;
// The confirm button's own red, translucent enough that the name still reads.
const ARMED_BACKGROUND = 'rgba(255, 135, 135, 0.14)';

const rowStyle = (armed: boolean): React.CSSProperties => ({
	...ROW,
	alignItems: 'flex-start',
	padding: '12px 0',
	// Arming washes the row and pulls it out to the card's edge, so the wash
	// has edges of its own rather than stopping at the text.
	...(armed
		? {
				background: ARMED_BACKGROUND,
				boxShadow: `inset 0 0 0 1px ${GUI_THEME.red}`,
				borderRadius: 8,
				margin: '0 -8px',
				padding: '12px 8px',
		  }
		: {}),
});

// The row's text: one line under another.
const linesStyle: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: LINE_GAP,
	minWidth: 0,
	flex: 1,
};

const lineStyle: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: 10,
	minWidth: 0,
};

const nameStyle: React.CSSProperties = {
	flex: 1,
	minWidth: 0,
	fontSize: TEXT.prose,
	fontWeight: 500,
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap',
};

// Where a repo is: a URL or a path, which are code and set in the code face.
const whereStyle: React.CSSProperties = {
	fontFamily: CODE_FONT,
	fontSize: TEXT.meta,
	color: GUI_THEME.dim,
	whiteSpace: 'nowrap',
	overflow: 'hidden',
	textOverflow: 'ellipsis',
};

// The right-hand column: the lock and the trash share one box, so the rows'
// text starts and ends in line whichever a row carries.
const controlStyle: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	width: 28,
	height: 24,
	flexShrink: 0,
};

const statusOf = (
	repo: GuiRepo,
	limit: number,
): {text: string; color: string} => {
	if (repo.overLimit) {
		return {
			text: `past the limit of ${limit} · not fetched`,
			color: GUI_THEME.amber,
		};
	}

	if (repo.error) {
		return {
			text: repo.error.split('\n')[0] ?? repo.error,
			color: GUI_THEME.red,
		};
	}

	if (!repo.cloned) return {text: 'not fetched yet', color: GUI_THEME.dim};

	return {
		text: repo.fetchedAt ? `fetched ${timeAgo(repo.fetchedAt)}` : 'cloned',
		color: GUI_THEME.dim,
	};
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const BRANCHES = [
	{id: 'default', label: 'default branch'},
	{id: 'all', label: 'all branches'},
];

const SINCE = [
	{id: 'board', label: 'since the board'},
	{id: 'all', label: 'all history'},
	{id: 'date', label: 'since a date'},
];

// The shared field at the panel's type size and corner.
const FIELD: React.CSSProperties = {
	borderRadius: 6,
	padding: '6px 10px',
	fontSize: TEXT.prose,
};

// What the repo is called, changed in place: its URL's basename unless set,
// which is how a fork and its upstream are told apart. Drawn as the name it
// is until focused, so the list reads as names rather than as a form. The row
// keys this on the label, so one changed elsewhere replaces the field, never
// gets sent back.
const LabelField = ({
	repo,
	onChange,
}: {
	repo: GuiRepo;
	onChange: (label: string) => void;
}) => {
	const [label, setLabel] = useState(repo.label);
	const [focused, setFocused] = useState(false);
	// A name changed elsewhere is taken while nobody is typing here; what is
	// being typed is never written over by an answer arriving under it.
	useEffect(() => {
		if (!focused) setLabel(repo.label);
	}, [repo.label]);
	// What was last sent: Enter and then a blur send one change, not two, and
	// a refused one is not raised again by every blur after.
	const sent = useRef<string | null>(null);
	const send = () => {
		const next = label.trim();
		if (next === repo.label || next === sent.current) return;

		sent.current = next;
		onChange(next);
	};

	return (
		<input
			data-testid="repo-label"
			aria-label={`What to call ${repo.url}`}
			title="What this repo is called on the board — click to change it"
			value={label}
			maxLength={24}
			onChange={event => setLabel(event.target.value)}
			onFocus={() => setFocused(true)}
			onBlur={() => {
				setFocused(false);
				send();
			}}
			onKeyDown={event => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				send();
			}}
			style={{
				// The shorthand first: it would reset the size set after it.
				font: 'inherit',
				...nameStyle,
				color: GUI_THEME.primary,
				background: focused ? GUI_THEME.well : 'transparent',
				border: `1px solid ${focused ? GUI_THEME.line : 'transparent'}`,
				borderRadius: 6,
				// Pulled left by its own padding, so the name sits where the own
				// repo's plain one does.
				padding: '2px 6px',
				marginLeft: -7,
				outline: 'none',
			}}
		/>
	);
};

// How much history is cloned: since the board was created, all of it, or
// since a date. The date input only appears for the third, on a line of its
// own under the two lists, which fill the row between them.
const SinceField = ({
	repo,
	onChange,
	portalInto,
}: {
	repo: GuiRepo;
	onChange: (since: string) => void;
	portalInto: () => HTMLElement | null;
}) => {
	const isDate = DATE.test(repo.since);
	const [picking, setPicking] = useState(false);
	const selected = isDate || picking ? 'date' : repo.since;

	return (
		<>
			<Dropdown
				testId="repo-since"
				width={CONTROL_WIDTH}
				color={GUI_THEME.dim2}
				portalInto={portalInto}
				value={SINCE.find(item => item.id === selected) ?? null}
				items={SINCE}
				onSelect={next => {
					if (next === 'date') return setPicking(true);

					setPicking(false);
					if (next !== repo.since) onChange(next);
				}}
			/>

			{(isDate || picking) && (
				<span style={{flexBasis: '100%', display: 'flex'}}>
					<Input
						data-testid="repo-since-date"
						type="date"
						defaultValue={isDate ? repo.since : ''}
						aria-label={`Clone ${repo.label} since`}
						onBlur={event => {
							const next = event.target.value;
							// Leaving the field unchanged is not a change to send.
							if (DATE.test(next) && next !== repo.since) onChange(next);
						}}
						style={{
							...FIELD,
							width: 'auto',
							padding: '4px 8px',
							fontSize: TEXT.ui,
						}}
					/>
				</span>
			)}
		</>
	);
};

const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

const windowOf = (since: string) =>
	since === 'all'
		? 'in all history'
		: since === 'board'
		? 'since the board began'
		: `since ${since}`;

const sizeOf = (bytes: number | null) =>
	bytes === null ? '—' : formatBytes(bytes);

const factStyle: React.CSSProperties = {...META, marginTop: 0};

// What a staged clone turned out to be, and what connecting it costs everyone:
// the confirm says the cost, since every contributor's epiq downloads it.
const PreviewCard = ({
	preview,
	limit,
	confirming,
	onConfirm,
	onCancel,
}: {
	preview: GuiRepoPreview;
	limit: number | null;
	confirming: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) => {
	const {repo, latest} = preview;
	const stakes = preview.overLimit
		? `Connect — past the board's limit${
				limit === null ? '' : ` of ${limit}`
		  }, it is listed and nobody downloads it`
		: `Connect — every contributor's epiq downloads about ${formatBytes(
				preview.bytes,
		  )} from ${preview.host} on their next sync (${plural(
				preview.contributors,
				'contributor',
		  )})`;

	return (
		<div data-testid="repo-preview" style={rowStyle(false)}>
			<span style={linesStyle}>
				<span style={lineStyle}>
					<span style={nameStyle}>{repo.label}</span>
					<Chip testId="repo-preview-host">{preview.host}</Chip>
				</span>
				<span title={repo.url} style={whereStyle}>
					{repo.url}
				</span>

				<span style={{display: 'flex', flexDirection: 'column'}}>
					<span data-testid="repo-preview-branch" style={factStyle}>
						{preview.defaultBranch
							? `default branch ${preview.defaultBranch}`
							: 'no default branch'}
					</span>
					<span
						data-testid="repo-preview-latest"
						style={{
							...factStyle,
							whiteSpace: 'nowrap',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
						title={latest?.subject}
					>
						{latest
							? `latest: ${latest.subject} · ${latest.author} · ${timeAgo(
									Date.parse(latest.date),
							  )}`
							: 'no commits yet'}
					</span>
					<span data-testid="repo-preview-commits" style={factStyle}>
						{plural(preview.commits, 'commit')} {windowOf(repo.since)} ·{' '}
						{preview.ticketCommits} name a ticket here
					</span>
					{preview.ticketCommits === 0 && (
						<span
							data-testid="repo-preview-warning"
							style={{...factStyle, color: GUI_THEME.amber}}
						>
							None name a ticket here — is this the right repo?
						</span>
					)}
					<span data-testid="repo-preview-size" style={factStyle}>
						{formatBytes(preview.bytes)} cloned · this board&apos;s repos take{' '}
						{formatBytes(preview.claimedBytes)} here
					</span>
				</span>

				<span style={{...lineStyle, justifyContent: 'flex-end'}}>
					<Button
						variant="ghost"
						testId="repo-preview-cancel"
						disabled={confirming}
						onClick={onCancel}
					>
						cancel
					</Button>
					<Button
						variant="primary"
						testId="repo-preview-confirm"
						disabled={confirming}
						onClick={onConfirm}
						style={{lineHeight: 1.4, textAlign: 'left'}}
					>
						{confirming ? 'connecting…' : stakes}
					</Button>
				</span>
			</span>
		</div>
	);
};

export const ReposSettings = ({
	state,
	onPreview,
	onConfirm,
	onCancelPreview,
	onChange,
	onRemove,
}: Props) => {
	const [adding, setAdding] = useState(false);
	const [url, setUrl] = useState('');
	// Removing cannot be taken back, so it takes two clicks.
	const remove = useArmed<string>();

	// Set while a confirm is unanswered: the slot closes once it lands, and
	// stays with its text if refused.
	const confirmed = useRef(false);
	const root = useRef<HTMLDivElement>(null);
	// The dropdowns' popovers are drawn into the section: above the panel, and
	// inside it for the click that dismisses it.
	const portalInto = () => root.current;

	const repos = state.data?.repos ?? [];
	const typed = url.trim();
	const problem = typed ? repoUrlProblem(typed) : null;
	const cloning = state.pending === 'preview';
	const anySized = repos.some(repo => repo.bytes !== null);

	useEffect(() => {
		if (!state.lastAction || !confirmed.current) return;

		confirmed.current = false;
		if (state.lastAction.ok) {
			setUrl('');
			setAdding(false);
		}
	}, [state.lastAction]);

	const submit = () => {
		if (!typed || problem || cloning) return;

		onPreview({url: typed});
	};

	const cancelAdd = () => {
		setUrl('');
		setAdding(false);
	};

	return (
		<div ref={root} data-testid="repos-section">
			<div style={{...META, marginTop: 0, padding: '12px 0 2px'}}>
				Commits from a connected repo show on the tickets they name and in the
				timeline. It is only read, from a copy epiq keeps on this machine;
				nothing is ever written to it. The list is kept on the board, so it
				reaches everyone.
			</div>

			{/* The board's own repo, listed first: the one every other row is
			    connected to. Locked, since it is read from the checkout and there
			    is nothing to set. */}
			{state.own && (
				<div data-testid="own-repo-row" style={rowStyle(false)}>
					<span style={linesStyle}>
						<span style={lineStyle}>
							<span style={nameStyle}>{state.own.label}</span>
							<Chip>this repo</Chip>
						</span>
						<span style={whereStyle} title={state.own.url ?? state.own.path}>
							{state.own.url ?? state.own.path}
						</span>
					</span>

					<span
						title="The board's own repo — its commits are always read"
						style={{...controlStyle, color: GUI_THEME.dim}}
					>
						<IconLock />
					</span>
				</div>
			)}

			{repos.map(repo => {
				const armed = remove.armed === repo.id;
				const status = statusOf(repo, state.data?.limit ?? 0);

				return (
					<div
						key={repo.id}
						data-testid="repo-row"
						data-armed={armed ? 'true' : 'false'}
						data-over-limit={repo.overLimit ? 'true' : 'false'}
						style={rowStyle(armed)}
					>
						<span style={linesStyle}>
							{/* The name and how it stands; where it is and what its copy
							    takes; what is read from it. Three lines, since the card
							    is narrow. */}
							<span style={lineStyle}>
								<LabelField
									key={repo.id}
									repo={repo}
									onChange={label => onChange({url: repo.url, label})}
								/>
								<Chip testId="repo-status" style={{color: status.color}}>
									{status.text}
								</Chip>
							</span>
							<span style={lineStyle}>
								<span
									data-testid="repo-url-shown"
									title={repo.url}
									style={{...whereStyle, flex: 1, minWidth: 0}}
								>
									{repo.url}
								</span>
								<Chip testId="repo-size">{sizeOf(repo.bytes)}</Chip>
							</span>
							<span style={{...lineStyle, flexWrap: 'wrap'}}>
								<Dropdown
									testId="repo-branches"
									width={CONTROL_WIDTH}
									color={GUI_THEME.dim2}
									portalInto={portalInto}
									value={BRANCHES.find(item => item.id === repo.branches)}
									items={BRANCHES}
									onSelect={next =>
										onChange({
											url: repo.url,
											branches: next as 'default' | 'all',
										})
									}
								/>
								<SinceField
									repo={repo}
									portalInto={portalInto}
									onChange={since => onChange({url: repo.url, since})}
								/>
							</span>
						</span>

						<IconButton
							testId="disconnect-repo"
							pressed={armed}
							label={armed ? 'confirm' : undefined}
							onBlur={remove.disarm}
							title={
								armed
									? `Click again to disconnect ${repo.label}`
									: `Disconnect ${repo.label}`
							}
							onClick={() => {
								if (remove.press(repo.id)) onRemove(repo.id);
							}}
						>
							<IconUnplug />
						</IconButton>
					</div>
				);
			})}

			{repos.length > 0 && state.data && (
				<div
					data-testid="repos-claimed"
					style={{...META, marginTop: 0, padding: '10px 0 0'}}
				>
					Their copies take{' '}
					{anySized ? formatBytes(state.data.claimedBytes) : '—'} on this
					machine.
				</div>
			)}

			{/* A new repo is cloned into a stage and described before anything
			    is connected; the field gives way to what it turned out to be. */}
			{state.preview ? (
				<PreviewCard
					preview={state.preview}
					limit={state.data?.limit ?? null}
					confirming={state.pending === 'confirm'}
					onCancel={onCancelPreview}
					onConfirm={() => {
						confirmed.current = true;
						onConfirm();
					}}
				/>
			) : adding ? (
				// The URL is checked as it is typed by the rule the server refuses
				// it by, so the answer is under the field before anything is sent.
				<div data-testid="connect-repo-row" style={rowStyle(false)}>
					<span style={linesStyle}>
						<Input
							data-testid="repo-url"
							aria-label="Remote URL of a repo to connect"
							value={url}
							autoFocus
							readOnly={cloning}
							placeholder="https://… or git@host:owner/repo.git"
							style={FIELD}
							onChange={event => setUrl(event.target.value)}
							onKeyDown={event => {
								if (event.key === 'Enter') submit();
								if (event.key === 'Escape') {
									// This row's, not the panel's.
									event.stopPropagation();
									if (cloning) onCancelPreview();
									else cancelAdd();
								}
							}}
						/>
						<span
							data-testid={
								problem
									? 'repo-url-problem'
									: cloning
									? 'repo-preview-pending'
									: undefined
							}
							style={{
								...META,
								marginTop: 0,
								color: problem ? GUI_THEME.red : GUI_THEME.dim,
							}}
						>
							{problem
								? `That URL ${problem}.`
								: cloning
								? 'Cloning it to see what it is. Nothing is connected until you confirm.'
								: REPO_URL_FORMS}
						</span>
						<span style={{...lineStyle, justifyContent: 'flex-end'}}>
							<Button
								variant="ghost"
								testId="connect-repo-cancel"
								onClick={cloning ? onCancelPreview : cancelAdd}
							>
								cancel
							</Button>
							<Button
								variant="primary"
								testId="connect-repo"
								disabled={!typed || problem !== null || cloning}
								onClick={submit}
							>
								{cloning ? 'cloning…' : 'connect'}
							</Button>
						</span>
					</span>
				</div>
			) : (
				<div style={{...ROW, borderBottom: 'none', paddingTop: 12}}>
					<span />
					<Button
						variant="primary"
						testId="connect-a-repo"
						onClick={() => setAdding(true)}
					>
						+ connect a repo
					</Button>
				</div>
			)}

			{/* A refusal only: a change that landed shows in the list itself. */}
			{state.lastAction && !state.lastAction.ok && (
				<div
					data-testid="repos-last-action"
					style={{...META, marginTop: 6, color: GUI_THEME.red}}
				>
					{state.lastAction.message}
				</div>
			)}
		</div>
	);
};
