import {useEffect, useRef, useState} from 'react';
import {GuiRepo} from '../lib/gui-state.model';
import {timeAgo} from '../lib/gui-format.helper';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {manageRowStyle} from '../lib/manage-row.style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {ReposState} from '../lib/use-repos';
import {Button} from './Button';
import {IconTrash} from './IconTrash';

type Props = {
	state: ReposState;
	onAdd: (payload: {
		url: string;
		branches?: 'default' | 'all';
		since?: string;
	}) => void;
	onRemove: (repo: string) => void;
	onFetch: () => void;
	onClose: () => void;
};

const fieldStyle: React.CSSProperties = {
	background: GUI_THEME.bg,
	color: GUI_THEME.primary,
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 4,
	padding: '3px 6px',
	font: 'inherit',
	fontSize: TEXT.meta,
	outline: 'none',
};

const statusOf = (repo: GuiRepo): {text: string; color: string} => {
	if (repo.error) {
		return {
			text: repo.error.split('\n')[0] ?? repo.error,
			color: GUI_THEME.red,
		};
	}

	if (!repo.cloned) {
		return {text: 'not fetched yet — sync to fetch', color: GUI_THEME.dim};
	}

	return {
		text: repo.fetchedAt ? `fetched ${timeAgo(repo.fetchedAt)}` : 'cloned',
		color: GUI_THEME.dim,
	};
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// How much history is cloned: since the board was created, all of it, or
// since a date. The date input only appears for the third.
const SinceField = ({
	repo,
	onChange,
}: {
	repo: GuiRepo;
	onChange: (since: string) => void;
}) => {
	const isDate = DATE.test(repo.since);
	const [picking, setPicking] = useState(false);

	return (
		<span style={{display: 'flex', alignItems: 'center', gap: 4}}>
			<select
				data-testid="repo-since"
				value={isDate || picking ? 'date' : repo.since}
				onChange={event => {
					const next = event.target.value;
					if (next === 'date') return setPicking(true);

					setPicking(false);
					if (next !== repo.since) onChange(next);
				}}
				aria-label={`How much of ${repo.label} to clone`}
				style={fieldStyle}
			>
				<option value="board">since the board</option>
				<option value="all">all history</option>
				<option value="date">since a date</option>
			</select>

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
					style={fieldStyle}
				/>
			)}
		</span>
	);
};

export const ManageReposModal = ({
	state,
	onAdd,
	onRemove,
	onFetch,
	onClose,
}: Props) => {
	const [url, setUrl] = useState('');
	const [armedId, setArmedId] = useState<string | null>(null);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	// The URL sent, until its answer: cleared once it lands, kept if refused.
	const sent = useRef<string | null>(null);
	const urlField = useRef<HTMLInputElement>(null);

	const repos = state.data ?? [];

	useEffect(() => {
		if (!state.lastAction || sent.current === null) return;

		const was = sent.current;
		sent.current = null;
		if (state.lastAction.ok) {
			setUrl(current => (current === was ? '' : current));
		}
	}, [state.lastAction]);

	// Escape from anywhere, or a click outside the panel.
	const panel = useDismissOnOutsideClick(true, onClose);

	// Focus on opening only, and back where it was on closing.
	useEffect(() => {
		const before = document.activeElement;
		urlField.current?.focus();

		return () => {
			if (before instanceof HTMLElement && before.isConnected) before.focus();
		};
	}, []);

	const submit = () => {
		if (!url.trim()) return;

		sent.current = url;
		onAdd({url: url.trim()});
	};

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: 'rgba(0, 0, 0, 0.25)',
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
				aria-label="Code repos"
				style={{
					marginTop: '-100px',
					width: 560,
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
					Code repos
				</div>

				<div style={{fontSize: 12, color: GUI_THEME.secondary}}>
					Commits in these repos link to a ticket the same way this repo's do:
					by the ticket's ref at the start of the subject. They are listed in{' '}
					<code>.epiq/project.json</code> — commit it to share them — and
					fetched on sync, once pushed.
				</div>

				<div
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: 2,
						maxHeight: 300,
						overflowY: 'auto',
					}}
				>
					{repos.length === 0 && state.data && (
						<div style={{fontSize: 12, color: GUI_THEME.dim}}>
							Only this repo's commits are read.
						</div>
					)}

					{repos.map(repo => {
						const armed = armedId === repo.id;
						const hovered = hoveredId === repo.id;
						const status = statusOf(repo);

						return (
							<div
								key={repo.id}
								data-testid="repo-row"
								data-armed={armed ? 'true' : 'false'}
								onMouseEnter={() => setHoveredId(repo.id)}
								onMouseLeave={() =>
									setHoveredId(current =>
										current === repo.id ? null : current,
									)
								}
								style={{
									...manageRowStyle({armed, hovered}),
									alignItems: 'start',
								}}
							>
								<div
									style={{
										display: 'flex',
										flexDirection: 'column',
										gap: 4,
										minWidth: 0,
										flex: 1,
									}}
								>
									<span style={{fontSize: 12, color: GUI_THEME.primary}}>
										{repo.label}
									</span>
									{/* Whole, wrapped rather than cut short: the host is not
									    always at the start, and it is what says where this is. */}
									<span
										data-testid="repo-url-shown"
										style={{
											fontSize: TEXT.label,
											color: GUI_THEME.dim,
											overflowWrap: 'anywhere',
										}}
									>
										{repo.url}
									</span>
									<span
										data-testid="repo-status"
										style={{fontSize: TEXT.label, color: status.color}}
									>
										{status.text}
									</span>
									<span style={{display: 'flex', gap: 6, paddingTop: 2}}>
										<select
											data-testid="repo-branches"
											aria-label={`Branches of ${repo.label} to read`}
											value={repo.branches}
											onChange={event =>
												onAdd({
													url: repo.url,
													branches: event.target.value as 'default' | 'all',
												})
											}
											style={fieldStyle}
										>
											<option value="default">default branch</option>
											<option value="all">all branches</option>
										</select>
										<SinceField
											repo={repo}
											onChange={since => onAdd({url: repo.url, since})}
										/>
									</span>
								</div>

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
										...(armed ? {border: `1px solid ${GUI_THEME.red}`} : {}),
									}}
								>
									{armed && <span style={{fontSize: 10}}>confirm</span>}
									<IconTrash />
								</Button>
							</div>
						);
					})}
				</div>

				<form
					onSubmit={event => {
						event.preventDefault();
						submit();
					}}
					style={{display: 'flex', gap: 8}}
				>
					<input
						data-testid="repo-url"
						ref={urlField}
						aria-label="Remote URL of a repo to add"
						value={url}
						onChange={event => setUrl(event.target.value)}
						placeholder="https://… or git@host:owner/repo.git"
						style={{...fieldStyle, flex: 1, padding: '6px 8px'}}
					/>
					<Button variant="primary" testId="add-repo" type="submit">
						Add
					</Button>
				</form>

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

				<div style={{display: 'flex', justifyContent: 'space-between'}}>
					<Button
						testId="fetch-repos"
						disabled={repos.length === 0 || state.fetching}
						onClick={onFetch}
					>
						{state.fetching ? 'fetching…' : 'fetch now'}
					</Button>
					<Button variant="ghost" onClick={onClose}>
						close
					</Button>
				</div>
			</div>
		</div>
	);
};
