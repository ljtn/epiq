import {useEffect, useRef, useState} from 'react';
import {GuiRepo} from '../lib/gui-state.model';
import {timeAgo} from '../lib/gui-format.helper';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {ReposState} from '../lib/use-repos';
import {repoUrlProblem, REPO_URL_FORMS} from '../../../lib/commits/repo-url.js';
import {Button} from './Button';
import {Dropdown} from './Dropdown';
import {Input} from './FormPrimitives';
import {IconLock} from './IconLock';
import {IconTrash} from './IconTrash';

type Props = {
	state: ReposState;
	onAdd: (payload: {
		url: string;
		branches?: 'default' | 'all';
		since?: string;
		label?: string;
	}) => void;
	onRemove: (repo: string) => void;
	onClose: () => void;
};

// One grid for every row: a name column as wide as a Dropdown, so the second
// line's first control sits under the name and its second under the details.
const ROW_PADDING = 12;
const COLUMN_GAP = 12;
const NAME_WIDTH = 200;
const LINE_GAP = 8;
// The confirm button's own red, translucent enough that the name still reads.
const ARMED_BACKGROUND = 'rgba(255, 135, 135, 0.14)';

const rowStyle = (armed: boolean): React.CSSProperties => ({
	display: 'flex',
	alignItems: 'center',
	gap: COLUMN_GAP,
	padding: `${ROW_PADDING}px ${ROW_PADDING + 2}px`,
	borderRadius: 8,
	background: armed ? ARMED_BACKGROUND : GUI_THEME.hover,
	// An inset ring rather than a border, so arming a row does not reflow it.
	boxShadow: armed ? `inset 0 0 0 1px ${GUI_THEME.red}` : undefined,
});

const lineStyle: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: COLUMN_GAP,
	minWidth: 0,
};

const nameStyle: React.CSSProperties = {
	width: NAME_WIDTH,
	flexShrink: 0,
	fontSize: TEXT.ui,
	overflow: 'hidden',
	textOverflow: 'ellipsis',
	whiteSpace: 'nowrap',
};

const detailStyle: React.CSSProperties = {
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
	width: 32,
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
				background: focused ? GUI_THEME.bg : 'transparent',
				border: `1px solid ${focused ? GUI_THEME.line : 'transparent'}`,
				borderRadius: 4,
				// Pulled left by its own padding, so the name sits where the own
				// repo's plain one does.
				padding: '2px 4px',
				marginLeft: -5,
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
				<input
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
						background: GUI_THEME.bg,
						color: GUI_THEME.primary,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 6,
						padding: '4px 8px',
						font: 'inherit',
						fontSize: TEXT.ui,
						outline: 'none',
					}}
				/>
			)}
		</span>
	);
};

export const ManageReposModal = ({state, onAdd, onRemove, onClose}: Props) => {
	const [adding, setAdding] = useState(false);
	const [url, setUrl] = useState('');
	// Two-step: the first click arms one row, the second commits it. Arming by
	// id rather than a boolean so moving to another row cancels the first.
	const [armedId, setArmedId] = useState<string | null>(null);

	// The URL sent, until its answer: the row closes once it lands, and stays
	// with its text if refused.
	const sent = useRef<string | null>(null);
	const linkButton = useRef<HTMLButtonElement>(null);

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

	// Escape from anywhere, or a click outside the panel.
	const panel = useDismissOnOutsideClick(true, onClose);
	// The dropdowns' popovers are drawn into the panel: above it, and inside.
	const portalInto = () => panel.current;

	// Focus on opening only — not again whenever the button comes back after
	// an add, which would take it from wherever it had been put — and back
	// where it was on closing.
	useEffect(() => {
		const before = document.activeElement;
		linkButton.current?.focus();

		return () => {
			if (before instanceof HTMLElement && before.isConnected) before.focus();
		};
	}, []);

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
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: GUI_THEME.scrim,
				backdropFilter: 'blur(.5px)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 1000,
			}}
		>
			<div
				ref={panel}
				data-testid="repos-modal"
				role="dialog"
				aria-modal="true"
				aria-label="Manage repos"
				style={{
					marginTop: '-100px',
					width: 640,
					background: GUI_THEME.panel,
					border: `1px solid ${GUI_THEME.line}`,
					borderRadius: 12,
					padding: 20,
					display: 'flex',
					flexDirection: 'column',
					gap: 14,
				}}
			>
				<div
					style={{
						color: GUI_THEME.secondary,
						fontSize: 10,
						letterSpacing: 1,
						textTransform: 'uppercase',
					}}
				>
					Manage repos
				</div>

				<div style={{fontSize: 12, color: GUI_THEME.secondary}}>
					Epiq can link other repositories: their commits show on the tickets
					they name and in the timeline.
				</div>

				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: 6,
						maxHeight: 320,
						overflowY: 'auto',
					}}
				>
					{/* The board's own repo, listed first: the one every other row is
					    linked to. Locked, since it is read from the checkout and there
					    is nothing to set. */}
					{state.own && (
						<div data-testid="own-repo-row" style={rowStyle(false)}>
							<span style={{...lineStyle, flex: 1}}>
								<span style={{...nameStyle, color: GUI_THEME.secondary}}>
									{state.own.label}
								</span>
								<span
									style={{
										...detailStyle,
										color: GUI_THEME.accent,
										flexShrink: 0,
									}}
								>
									this repo
								</span>
								<span style={detailStyle}>
									{state.own.url ?? state.own.path}
								</span>
							</span>

							<span
								title="The board's own repo — its commits are always read"
								style={{...controlStyle, color: GUI_THEME.dim, opacity: 0.7}}
							>
								<IconLock />
							</span>
						</div>
					)}

					{repos.map(repo => {
						const armed = armedId === repo.id;
						const status = statusOf(repo);

						return (
							<div
								key={repo.id}
								data-testid="repo-row"
								data-armed={armed ? 'true' : 'false'}
								style={rowStyle(armed)}
							>
								<span
									style={{
										display: 'flex',
										flexDirection: 'column',
										gap: LINE_GAP,
										minWidth: 0,
										flex: 1,
									}}
								>
									{/* Name and where it is on the first line; what is read
									    from it on the second, each control under a column. */}
									<span style={lineStyle}>
										<LabelField
											key={repo.label}
											repo={repo}
											onChange={label => onAdd({url: repo.url, label})}
										/>
										<span
											data-testid="repo-url-shown"
											title={repo.url}
											style={{...detailStyle, minWidth: 0}}
										>
											{repo.url}
										</span>
										<span
											data-testid="repo-status"
											style={{
												...detailStyle,
												color: status.color,
												flexShrink: 0,
												marginLeft: 'auto',
											}}
										>
											{status.text}
										</span>
									</span>
									<span style={lineStyle}>
										<Dropdown
											testId="repo-branches"
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

								<span style={controlStyle}>
									<Button
										variant="ghost"
										testId="remove-repo"
										title={
											armed
												? `Click again to stop reading ${repo.label}`
												: `Remove ${repo.label}`
										}
										onClick={() => {
											if (!armed) return setArmedId(repo.id);

											onRemove(repo.id);
											setArmedId(null);
										}}
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: 6,
											color: armed ? GUI_THEME.red : GUI_THEME.dim,
											// The whole shorthand, and only when armed: Button sets
											// `border` itself, and React warns that an element given
											// both it and `borderColor` can drop whichever loses the
											// race. Spreading `border: undefined` is not the other
											// branch — that reads as "remove this style".
											...(armed ? {border: `1px solid ${GUI_THEME.red}`} : {}),
										}}
									>
										{armed && <span style={{fontSize: 10}}>confirm</span>}
										<IconTrash />
									</Button>
								</span>
							</div>
						);
					})}

					{/* The row being added, drawn as the row it becomes. The URL is
					    checked as it is typed by the rule the server refuses it by,
					    so the answer is under the field before anything is sent. */}
					{adding && (
						<div data-testid="add-repo-row" style={rowStyle(false)}>
							<span
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: LINE_GAP,
									minWidth: 0,
									flex: 1,
								}}
							>
								<span style={lineStyle}>
									<Input
										data-testid="repo-url"
										aria-label="Remote URL of a repo to link"
										value={url}
										autoFocus
										placeholder="https://… or git@host:owner/repo.git"
										// The ticket panel's field at this row's type size.
										style={{fontSize: TEXT.ui, padding: '5px 8px'}}
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
									<Button
										testId="add-repo"
										disabled={!typed || problem !== null}
										onClick={submit}
									>
										link
									</Button>
									<Button variant="ghost" onClick={cancelAdd}>
										cancel
									</Button>
								</span>
								<span
									data-testid={problem ? 'repo-url-problem' : undefined}
									style={{
										...detailStyle,
										color: problem ? GUI_THEME.red : GUI_THEME.dim,
									}}
								>
									{problem ? `That URL ${problem}.` : REPO_URL_FORMS}
								</span>
							</span>

							{/* The control column, empty: the row's text ends in line
							    with the rows above. */}
							<span style={controlStyle} />
						</div>
					)}
				</div>

				{state.lastAction && (
					<div
						data-testid="repos-last-action"
						style={{
							fontSize: TEXT.meta,
							color: state.lastAction.ok ? GUI_THEME.dim : GUI_THEME.red,
						}}
					>
						{state.lastAction.message}
					</div>
				)}

				<div
					style={{
						display: 'flex',
						justifyContent: 'space-between',
						alignItems: 'center',
					}}
				>
					<span>
						{!adding && (
							<Button
								variant="ghost"
								testId="link-repo"
								ref={linkButton}
								onClick={() => setAdding(true)}
							>
								+ link a repo
							</Button>
						)}
					</span>
					<Button variant="ghost" onClick={onClose}>
						close
					</Button>
				</div>
			</div>
		</div>
	);
};
