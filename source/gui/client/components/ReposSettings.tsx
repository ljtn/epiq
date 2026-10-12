import {useEffect, useRef, useState} from 'react';
import {CODE_FONT} from '../lib/code-text.style';
import {GuiRepo} from '../lib/gui-state.model';
import {timeAgo} from '../lib/gui-format.helper';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {META, ROW} from '../lib/identity-panel.style';
import {useArmed} from '../lib/use-armed';
import {ReposState} from '../lib/use-repos';
import {repoUrlProblem, REPO_URL_FORMS} from '../../../lib/commits/repo-url.js';
import {Button} from './Button';
import {Chip} from './Chip';
import {Dropdown} from './Dropdown';
import {Input} from './FormPrimitives';
import {IconButton} from './IconButton';
import {IconLock} from './IconLock';
import {IconTrash} from './IconTrash';

// The repos the board reads commits from, as a section of the settings panel:
// its own first and locked, then the linked ones, then the row that links
// another. Rows, not cards — the section is the card.

type Props = {
	state: ReposState;
	onAdd: (payload: {
		url: string;
		branches?: 'default' | 'all';
		since?: string;
		label?: string;
	}) => void;
	onRemove: (repo: string) => void;
};

// Two of these and a gap fit the card's width with its padding taken.
const CONTROL_WIDTH = 170;
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

const statusOf = (repo: GuiRepo): {text: string; color: string} => {
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
// since a date. The date input only appears for the third.
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
		<span style={{display: 'flex', alignItems: 'center', gap: LINE_GAP}}>
			<Dropdown
				testId="repo-since"
				width={CONTROL_WIDTH}
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
			)}
		</span>
	);
};

export const ReposSettings = ({state, onAdd, onRemove}: Props) => {
	const [adding, setAdding] = useState(false);
	const [url, setUrl] = useState('');
	// Removing cannot be taken back, so it takes two clicks.
	const remove = useArmed<string>();

	// The URL sent, until its answer: the row closes once it lands, and stays
	// with its text if refused.
	const sent = useRef<string | null>(null);
	const root = useRef<HTMLDivElement>(null);
	// The dropdowns' popovers are drawn into the section: above the panel, and
	// inside it for the click that dismisses it.
	const portalInto = () => root.current;

	const repos = state.data ?? [];
	const typed = url.trim();
	const problem = typed ? repoUrlProblem(typed) : null;

	useEffect(() => {
		if (!state.lastAction || sent.current === null) return;

		sent.current = null;
		if (state.lastAction.ok) {
			setUrl('');
			setAdding(false);
		}
	}, [state.lastAction]);

	const submit = () => {
		if (!typed || problem) return;

		sent.current = url;
		onAdd({url: typed});
	};

	const cancelAdd = () => {
		setUrl('');
		setAdding(false);
	};

	return (
		<div ref={root} data-testid="repos-section">
			<div style={{...META, marginTop: 0, padding: '12px 0 2px'}}>
				Commits from a linked repo show on the tickets they name and in the
				timeline. The list is kept in the project file, so it reaches everyone.
			</div>

			{/* The board's own repo, listed first: the one every other row is
			    linked to. Locked, since it is read from the checkout and there
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
				const status = statusOf(repo);

				return (
					<div
						key={repo.id}
						data-testid="repo-row"
						data-armed={armed ? 'true' : 'false'}
						style={rowStyle(armed)}
					>
						<span style={linesStyle}>
							{/* The name and how it stands; where it is; what is read
							    from it. Three lines, since the card is narrow. */}
							<span style={lineStyle}>
								<LabelField
									key={repo.label}
									repo={repo}
									onChange={label => onAdd({url: repo.url, label})}
								/>
								<Chip testId="repo-status" style={{color: status.color}}>
									{status.text}
								</Chip>
							</span>
							<span
								data-testid="repo-url-shown"
								title={repo.url}
								style={whereStyle}
							>
								{repo.url}
							</span>
							<span style={lineStyle}>
								<Dropdown
									testId="repo-branches"
									width={CONTROL_WIDTH}
									portalInto={portalInto}
									value={BRANCHES.find(item => item.id === repo.branches)}
									items={BRANCHES}
									onSelect={next =>
										onAdd({
											url: repo.url,
											branches: next as 'default' | 'all',
										})
									}
								/>
								<SinceField
									repo={repo}
									portalInto={portalInto}
									onChange={since => onAdd({url: repo.url, since})}
								/>
							</span>
						</span>

						<IconButton
							testId="remove-repo"
							pressed={armed}
							label={armed ? 'confirm' : undefined}
							title={
								armed
									? `Click again to stop reading ${repo.label}`
									: `Remove ${repo.label}`
							}
							onClick={() => {
								if (remove.press(repo.id)) onRemove(repo.id);
							}}
						>
							<IconTrash />
						</IconButton>
					</div>
				);
			})}

			{/* The row being added, drawn as the row it becomes. The URL is
			    checked as it is typed by the rule the server refuses it by,
			    so the answer is under the field before anything is sent. */}
			{adding ? (
				<div data-testid="add-repo-row" style={rowStyle(false)}>
					<span style={linesStyle}>
						<Input
							data-testid="repo-url"
							aria-label="Remote URL of a repo to link"
							value={url}
							autoFocus
							placeholder="https://… or git@host:owner/repo.git"
							style={FIELD}
							onChange={event => setUrl(event.target.value)}
							onKeyDown={event => {
								if (event.key === 'Enter') submit();
								if (event.key === 'Escape') {
									// This row's, not the panel's.
									event.stopPropagation();
									cancelAdd();
								}
							}}
						/>
						<span
							data-testid={problem ? 'repo-url-problem' : undefined}
							style={{
								...META,
								marginTop: 0,
								color: problem ? GUI_THEME.red : GUI_THEME.dim,
							}}
						>
							{problem ? `That URL ${problem}.` : REPO_URL_FORMS}
						</span>
						<span style={{...lineStyle, justifyContent: 'flex-end'}}>
							<Button variant="ghost" onClick={cancelAdd}>
								cancel
							</Button>
							<Button
								variant="primary"
								testId="add-repo"
								disabled={!typed || problem !== null}
								onClick={submit}
							>
								link
							</Button>
						</span>
					</span>
				</div>
			) : (
				<div style={{...ROW, borderBottom: 'none', paddingTop: 12}}>
					<span />
					<Button
						variant="primary"
						testId="link-repo"
						onClick={() => setAdding(true)}
					>
						+ link a repo
					</Button>
				</div>
			)}

			{state.lastAction && (
				<div
					data-testid="repos-last-action"
					style={{
						...META,
						marginTop: 6,
						color: state.lastAction.ok ? GUI_THEME.dim : GUI_THEME.red,
					}}
				>
					{state.lastAction.message}
				</div>
			)}
		</div>
	);
};
