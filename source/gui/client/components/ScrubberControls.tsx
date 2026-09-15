// The row of controls above the chart: what the window covers, where the
// needle steps to next, which panels are open, and the button that plays the
// whole thing back. Presentational — props in, JSX out; the state behind them
// is TimeScrubber's.

import {GUI_THEME} from '../lib/gui-theme';
import {
	formatPeriodLabel,
	isPeriodWindow,
	LayoutMode,
	PeriodRange,
	Scope,
	scopeButtonLabel,
	SCOPES,
	BoardView,
	FilterAxis,
} from '../lib/scrubber';
import {AxisState} from '../lib/board-selection';
import {GuiEventIdentity} from '../lib/gui-state.model';
import {Checkbox} from './Checkbox';
import {IconBars} from './IconBars';
import {IconChevronLeft} from './IconChevronLeft';
import {IconChevronRight} from './IconChevronRight';
import {IconFlashlight} from './IconFlashlight';
import {IconFlow} from './IconFlow';
import {IconLog} from './IconLog';
import {IconTimeline} from './IconTimeline';
import {IconPlay} from './IconPlayback';
import {IconScatter} from './IconScatter';
import {selectTriggerStyle} from '../lib/select-style';
import {
	BoardSeriesGroup,
	CommitSeriesGroup,
	mutedStyle,
	ScopeSelect,
} from './ScrubberSelects';

const toggleButtonStyle = (active: boolean): React.CSSProperties => ({
	background: 'transparent',
	border: `1px solid ${active ? GUI_THEME.accent : GUI_THEME.dim}`,
	color: active ? GUI_THEME.accent : GUI_THEME.dim,
	borderRadius: 6,
	fontSize: 10,
	padding: '2px 8px',
	cursor: 'pointer',
});

// Borderless, marked the way Tabs marks the open tab. The icon toggles below
// keep their box: they carry no label, so the border is what holds their shape.
const scopeButtonStyle = (active: boolean): React.CSSProperties => ({
	background: 'transparent',
	border: 'none',
	borderBottom: `1px solid ${active ? GUI_THEME.accent : 'transparent'}`,
	color: active ? GUI_THEME.primary : GUI_THEME.dim,
	borderRadius: 0,
	fontSize: 10,
	padding: '2px 6px 3px',
	cursor: 'pointer',
});

const iconToggleButtonStyle = (active: boolean): React.CSSProperties => ({
	...toggleButtonStyle(active),
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	padding: '3px 7px',
});

// The two panel toggles and the transport all sit in one family: a panel, a
// hairline and a glyph. Nothing here is the brightest thing on the bar.
//
// Cornered the way the player's own transport is rather than the way a card is:
// a 6px radius on a box this small reads as a pill, and these are chrome.
const headerButtonStyle: React.CSSProperties = {
	background: GUI_THEME.panel2,
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 3,
	color: GUI_THEME.secondary,
	padding: '3px 7px',
	cursor: 'pointer',
	display: 'inline-flex',
	alignItems: 'center',
};

// The pager wears what the rest of this bar's icon buttons wear. It used to
// have a border of its own colour, a rounder corner and a unicode triangle for
// a glyph — three ways of not matching the row it sits on.
const navButtonStyle: React.CSSProperties = {
	...headerButtonStyle,
	padding: '2px 4px',
};

export const ScrubberControls = ({
	connected,
	scope,
	offset,
	periodRange,
	zoomed,
	atLatest,
	windowOnly,
	windowFilterable,
	canPlay,
	playTitle,
	onPlay,
	narrow,
	ticketFocus,
	textFilter,
	onChangeTextFilter,
	layoutMode,
	showIssues,
	showCommits,
	linkedCommitsOnly,
	onChangeLinkedCommitsOnly,
	allBoards,
	boardView,
	identitiesByAxis,
	hiddenIdsByAxis,
	axisStates,
	narrowed,
	categoriesExpanded,
	expandedAxis,
	categoriesFiltered,
	isScrubbing,
	onReturnToLive,
	onChangeScope,
	onChangeOffset,
	onChangeWindowOnly,
	onChangeLayoutMode,
	onChangeShowIssues,
	onChangeShowCommits,
	onChangeAllBoards,
	onToggleAxis,
	onToggleIdentity,
	onOnlyIdentity,
	onToggleCategoriesExpanded,
	onSetExpandedAxis,
}: {
	// Nothing can be fetched with the socket down, so the controls say so rather
	// than moving the selection over a chart that cannot follow.
	connected: boolean;
	scope: Scope;
	offset: number;
	periodRange: PeriodRange | null;
	// The window was dragged out on the chart, so it is none of the periods the
	// scope row lists and a seventh option stands for it instead.
	zoomed: boolean;
	// The window already reaches the present, so there is nothing later to page
	// to.
	atLatest: boolean;
	// The board is narrowed to the tickets this window has an event for.
	windowOnly: boolean;
	canPlay: boolean;
	playTitle: string;
	onPlay: () => void;
	// The row has no space for the scope buttons, so they fold into a select.
	narrow: boolean;
	// False where the window came back as counts alone, naming no tickets to
	// narrow to.
	windowFilterable: boolean;
	// The chart is narrowed to the open ticket — its own stretch, and its
	// events only — which the ticket's panel switches on and off.
	ticketFocus: boolean;
	// The board's text query, one more narrowing on this bar.
	textFilter: string;
	onChangeTextFilter: (next: string) => void;
	layoutMode: LayoutMode;
	showIssues: boolean;
	showCommits: boolean;
	// The Code series down to commits linked to a ticket.
	linkedCommitsOnly: boolean;
	onChangeLinkedCommitsOnly: (next: boolean) => void;
	allBoards: boolean;
	boardView: BoardView;
	// A legend per filter axis, and what is unticked on each: every axis narrows
	// the board, not just the one the chart is coloured by.
	identitiesByAxis: Record<FilterAxis, GuiEventIdentity[]>;
	hiddenIdsByAxis: Record<FilterAxis, ReadonlySet<string>>;
	// What each top-level row says: off, on with everything, or on with some.
	axisStates: Record<FilterAxis, AxisState>;
	// Any axis at all is narrowed, which is what the collapsed trigger reports.
	narrowed: boolean;
	categoriesExpanded: boolean;
	// The one axis whose list is open, or null while none is.
	expandedAxis: FilterAxis | null;
	// False where the server capped the window: the buckets it fell back to are
	// pre-summed across every kind, so there is nothing to filter.
	categoriesFiltered: boolean;
	isScrubbing: boolean;
	onReturnToLive: () => void;
	onChangeScope: (scope: Scope) => void;
	onChangeOffset: (offset: number) => void;
	onChangeWindowOnly: (next: boolean) => void;
	onChangeLayoutMode: (mode: LayoutMode) => void;
	onChangeShowIssues: (next: boolean) => void;
	onChangeShowCommits: (next: boolean) => void;
	onChangeAllBoards: (next: boolean) => void;
	onToggleAxis: (axis: FilterAxis, on: boolean) => void;
	onToggleIdentity: (axis: FilterAxis, id: string, next: boolean) => void;
	onOnlyIdentity: (axis: FilterAxis, id: string) => void;
	onToggleCategoriesExpanded: () => void;
	onSetExpandedAxis: (axis: FilterAxis | null) => void;
}) => {
	const everythingInScope = !isPeriodWindow(scope, zoomed);

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'flex-end',
				// The same gap between the groups as within the narrowing group:
				// the row fits a laptop's width with the pager up by a few pixels.
				gap: 10,
				// Sized by the bar rather than by what is on it: the text filter is
				// the one control here that gives when the row is tight, and a row
				// sized to its own content would never be tight.
				flex: '1 1 0',
				minWidth: 0,
			}}
		>
			<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
				{(scope !== 'all' || zoomed || ticketFocus) && (
					<div style={{display: 'flex', alignItems: 'center', gap: 2}}>
						<button
							title={
								ticketFocus ? 'No paging while narrowed to a ticket' : 'Earlier'
							}
							disabled={!connected || ticketFocus}
							onClick={() => onChangeOffset(offset + 1)}
							aria-label="Earlier"
							style={{
								...navButtonStyle,
								...(connected && !ticketFocus ? {} : mutedStyle),
							}}
						>
							<IconChevronLeft size={12} />
						</button>
						<span
							style={{
								fontSize: 10,
								color: GUI_THEME.dim,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								// Fixed, not min, so the changing label never shifts the
								// buttons around it.
								width: 88,
								flexShrink: 0,
								textAlign: 'center',
							}}
						>
							{formatPeriodLabel(
								scope,
								offset,
								periodRange,
								zoomed || ticketFocus,
							)}
						</span>
						<button
							title="Later"
							disabled={atLatest || !connected || ticketFocus}
							onClick={() => onChangeOffset(offset - 1)}
							aria-label="Later"
							style={{
								...navButtonStyle,
								opacity: atLatest || ticketFocus ? 0.35 : 1,
								cursor: atLatest || ticketFocus ? 'default' : 'pointer',
							}}
						>
							<IconChevronRight size={12} />
						</button>
					</div>
				)}

				{narrow ? (
					<ScopeSelect
						scope={scope}
						zoomed={zoomed}
						connected={connected}
						onChangeScope={onChangeScope}
					/>
				) : (
					<div style={{display: 'flex', gap: 2}}>
						{SCOPES.map(option => (
							<button
								key={option}
								// Nothing in this row is what a zoomed window is, so while one is
								// up none of them reads as pressed and Zoom does instead.
								aria-pressed={!zoomed && !ticketFocus && scope === option}
								disabled={!connected}
								onClick={() => onChangeScope(option)}
								style={{
									...scopeButtonStyle(
										!zoomed && !ticketFocus && scope === option,
									),
									...(connected ? {} : mutedStyle),
								}}
							>
								{scopeButtonLabel(option)}
							</button>
						))}

						{/* Only ever the current state, never a way in: a window is zoomed by
				    dragging one out on the chart, and left by naming any period to
				    its left. It sits at the end of the row because it is not a period
				    on the same scale as the rest.

				    Faded rather than unmounted, the way the pager's ▶ sits out a
				    period it cannot go to: the row must not shift by its width
				    underneath the pointer as a zoom comes and goes. Its title carries
				    the gesture, since a button nobody can press has to say why.

				    Flat under a ticket window even while a dragged one is still
				    held: that window is not what is on screen, and the whole row
				    reads as unpressed there, the scope buttons included. */}
						<button
							title={
								ticketFocus
									? 'Held while narrowed to a ticket'
									: zoomed
									? 'Zoomed by a drag — pick a period to leave'
									: 'Drag across the chart to zoom'
							}
							aria-pressed={zoomed && !ticketFocus}
							disabled
							style={{
								...scopeButtonStyle(zoomed && !ticketFocus),
								opacity: zoomed && !ticketFocus ? 1 : 0.35,
								cursor: 'default',
							}}
						>
							Zoom
						</button>
					</div>
				)}
			</div>

			<div style={{display: 'flex', gap: 2}}>
				<button
					title="Volume per period"
					aria-label="Volume"
					aria-pressed={layoutMode === 'even'}
					disabled={!connected}
					onClick={() => onChangeLayoutMode('even')}
					style={{
						...iconToggleButtonStyle(layoutMode === 'even'),
						...(connected ? {} : mutedStyle),
					}}
				>
					<IconBars size={13} />
				</button>
				<button
					title="Events by moment and time of day"
					aria-label="Events"
					aria-pressed={layoutMode === 'real'}
					disabled={!connected}
					onClick={() => onChangeLayoutMode('real')}
					style={{
						...iconToggleButtonStyle(layoutMode === 'real'),
						...(connected ? {} : mutedStyle),
					}}
				>
					<IconScatter size={13} />
				</button>
				<button
					title="Flow between swimlanes, one line per ticket"
					aria-label="Flow"
					aria-pressed={layoutMode === 'flow'}
					disabled={!connected}
					onClick={() => onChangeLayoutMode('flow')}
					style={{
						...iconToggleButtonStyle(layoutMode === 'flow'),
						...(connected ? {} : mutedStyle),
					}}
				>
					<IconFlow size={13} />
				</button>
			</div>

			<div
				style={{
					display: 'flex',
					// A touch closer than the row's own gap: this is one group of
					// narrowings, and it is the row's widest at a laptop's width.
					gap: 10,
					alignItems: 'center',
					// Shrinkable past its content, which is what lets the text filter
					// at its end give way on a tight row; nothing else in here can.
					minWidth: 0,
				}}
			>
				<CommitSeriesGroup
					connected={connected}
					idle={layoutMode === 'flow'}
					showCommits={showCommits}
					linkedOnly={linkedCommitsOnly}
					onChangeShowCommits={onChangeShowCommits}
					onChangeLinkedOnly={onChangeLinkedCommitsOnly}
				/>
				<BoardSeriesGroup
					connected={connected}
					showIssues={showIssues}
					view={boardView}
					identitiesByAxis={identitiesByAxis}
					hiddenIdsByAxis={hiddenIdsByAxis}
					axisStates={axisStates}
					narrowed={narrowed}
					expanded={categoriesExpanded}
					expandedAxis={expandedAxis}
					filtered={categoriesFiltered}
					onChangeShowIssues={onChangeShowIssues}
					onToggleAxis={onToggleAxis}
					onToggleIdentity={onToggleIdentity}
					onOnlyIdentity={onOnlyIdentity}
					onToggleExpanded={onToggleCategoriesExpanded}
					onSetExpandedAxis={onSetExpandedAxis}
				/>

				{/* Beside the series checkboxes rather than by the scope row, so every
			    narrowing on this bar is in one place. The window it lights is the
			    one those buttons select — under "All" that is every event there
			    is, which narrows nothing, so it goes flat instead of pretending
			    to. */}
				<SpotlightToggle
					title={
						ticketFocus
							? 'Already narrowed to a ticket'
							: everythingInScope
							? 'Pick a period first'
							: !windowFilterable
							? 'Too many events to tell tickets apart'
							: 'Spotlight tickets active in this window'
					}
					on={windowOnly}
					// Unlike its neighbours it asks the socket for nothing — it
					// narrows what is already on screen — so offline it can still be
					// let go of, just not taken up over a window that can no longer be
					// refreshed.
					// Flat under the ticket narrowing, which has already taken the
					// board down to one card: there is nothing left for a window to
					// take away, and two lit boxes would claim otherwise.
					disabled={
						ticketFocus ||
						everythingInScope ||
						!windowFilterable ||
						(!connected && !windowOnly)
					}
					onChange={onChangeWindowOnly}
				/>

				{/* <Checkbox
				label="All boards"
				checked={allBoards}
				activeColor={GUI_THEME.accent}
				onChange={onChangeAllBoards}
			/> */}

				<TextFilterInput value={textFilter} onChange={onChangeTextFilter} />
			</div>

			{/* Present while live too, as an empty slot rather than a word: it sits
		    at the end of the row and the transport now sits past it, so a label
		    naming that end has nothing left to name. Held rather than unmounted
		    so entering history never resizes the row.

		    "Now" only over a window that runs up to the present, though. It sits
		    Wearing what every other button on this row wears while it is one,
		    and nothing at all while it is not: an empty slot with a panel and a
		    border would read as a control that had stopped working. The width is
		    held either way, so leaving history never shifts the row. */}
			<button
				onClick={onReturnToLive}
				disabled={!isScrubbing}
				title={isScrubbing ? 'Back to live' : undefined}
				// Inverted while the board is in the past: bright ground, dark text.
				// Every other control on this row is quiet chrome, and this one is
				// the standing answer to "why is nothing I do landing?" — it has to
				// be the thing you cannot miss.
				style={{
					...(isScrubbing
						? {
								...headerButtonStyle,
								background: GUI_THEME.accent,
								border: `1px solid ${GUI_THEME.accent}`,
						  }
						: {background: 'transparent', border: 'none'}),
					color: isScrubbing ? GUI_THEME.bg : GUI_THEME.dim,
					fontFamily: 'inherit',
					fontSize: 10,
					width: 60,
					boxSizing: 'border-box',
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					padding: '2px 8px',
					cursor: isScrubbing ? 'pointer' : 'default',
					whiteSpace: 'nowrap',
					flexShrink: 0,
				}}
			>
				{isScrubbing ? 'Resume' : ''}
			</button>

			{/* Last on the row, past everything that draws or narrows the window:
			    it is the one control here that starts something. */}
			<ScrubberPlayButton
				canPlay={canPlay}
				playTitle={playTitle}
				onPlay={onPlay}
			/>
		</div>
	);
};

// The spotlight: the board narrowed to the tickets with activity in the
// timeline's window. A flashlight that lights while it narrows — borderless,
// like the boxes it sits among, since it is one more narrowing and not a
// layout switch. Drawn once, since the collapsed header puts the same one up
// when the rest of the row is not on screen.
const spotlightStyle = (on: boolean): React.CSSProperties => ({
	display: 'inline-flex',
	alignItems: 'center',
	background: 'transparent',
	border: 'none',
	padding: '2px 3px',
	color: on ? GUI_THEME.accent : GUI_THEME.dim,
	cursor: 'pointer',
	transition: 'color 120ms ease',
});

export const SpotlightToggle = ({
	on,
	disabled = false,
	title,
	onChange,
}: {
	on: boolean;
	disabled?: boolean;
	title: string;
	onChange: (next: boolean) => void;
}) => (
	<button
		type="button"
		data-testid="spotlight"
		aria-label="Spotlight"
		aria-pressed={on}
		disabled={disabled}
		title={title}
		onClick={() => onChange(!on)}
		style={{
			...spotlightStyle(on),
			...(disabled ? mutedStyle : {}),
		}}
	>
		<IconFlashlight size={16} lit={on} />
	</button>
);

// The board's text query, beside the other narrowings. Worn like the selects
// on this row — the same fill, no border — so the bar reads as one family of
// controls; lit in the accent while it holds a query, since unlike its
// neighbours it has no box to show it is on, and a word typed a while ago
// reads as a board missing its tickets. The tickets it keeps are the ones the
// columns show and the ones the chart plots; Escape empties it and lets go of
// the focus.
export const TextFilterInput = ({
	value,
	onChange,
}: {
	value: string;
	onChange: (next: string) => void;
}) => {
	const held = value.trim() !== '';

	return (
		<input
			data-testid="text-filter"
			type="search"
			value={value}
			placeholder="ref or title"
			aria-label="Filter tickets by ref or title"
			title="Filter tickets by ref or title"
			spellCheck={false}
			onChange={event => onChange(event.target.value)}
			onKeyDown={event => {
				if (event.key === 'Escape') {
					onChange('');
					event.currentTarget.blur();
				}
			}}
			style={{
				...selectTriggerStyle(
					held ? GUI_THEME.accent : GUI_THEME.primary,
					false,
				),
				// Also the one thing on this row that can give, down to the short
				// width, should the row run out of room before the narrow-bar
				// breakpoint folds the scope buttons: a query is readable at that
				// size, and the transport would otherwise be pushed off the edge.
				width: 110,
				minWidth: 70,
				flexShrink: 1,
				boxShadow: held ? `0 0 0 1px ${GUI_THEME.accent}` : undefined,
				outline: 'none',
			}}
		/>
	);
};

export const ScrubberHeader = ({
	collapsed,
	onToggleCollapsed,
	logOpen,
	onChangeLogOpen,
}: {
	collapsed: boolean;
	onToggleCollapsed: () => void;
	// The event log panel is on the board.
	logOpen: boolean;
	onChangeLogOpen: (next: boolean) => void;
}) => (
	<div
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 8,
			fontSize: 11,
			whiteSpace: 'nowrap',
		}}
	>
		{/* First, and marked with what it opens rather than with a chevron: the
		    panel beside the board is a thing in its own right, where the chevron
		    next to it only shows and hides the bar it sits on.

		    Here rather than in the controls row so it survives that bar being
		    collapsed, and it asks the socket for nothing — the window it lists is
		    already on screen — so it stays usable offline. */}
		<button
			data-testid="log-toggle"
			onClick={() => onChangeLogOpen(!logOpen)}
			title={logOpen ? 'Hide the event log' : 'Show the event log'}
			aria-label={logOpen ? 'Hide the event log' : 'Show the event log'}
			aria-pressed={logOpen}
			style={{
				...headerButtonStyle,
				color: logOpen ? GUI_THEME.accent : GUI_THEME.secondary,
			}}
		>
			<IconLog size={13} />
		</button>

		{/* Marked with the thing it opens, as its neighbour is, and lit the same
		    way while it is open — a chevron said only "there is more here", which
		    is true of every disclosure on the page. */}
		<button
			data-testid="timeline-toggle"
			onClick={onToggleCollapsed}
			title={collapsed ? 'Show time travel' : 'Hide time travel'}
			aria-label={collapsed ? 'Show time travel' : 'Hide time travel'}
			aria-expanded={!collapsed}
			style={{
				...headerButtonStyle,
				color: collapsed ? GUI_THEME.secondary : GUI_THEME.accent,
			}}
		>
			<IconTimeline size={14} />
		</button>
	</div>
);

// The transport, wherever it is put: among the controls while the bar is open,
// and beside the collapsed row's own box when it is not — it must not go out of
// reach just because the charts are shut.
export const ScrubberPlayButton = ({
	canPlay,
	playTitle,
	onPlay,
}: {
	// False where the window holds nothing to play, or the socket is down.
	canPlay: boolean;
	// Why, when it cannot be pressed — a window can be unplayable for opposite
	// reasons, and a button nobody can press has to say which.
	playTitle: string;
	onPlay: () => void;
}) => (
	<button
		data-testid="theatre-play"
		onClick={onPlay}
		disabled={!canPlay}
		title={playTitle}
		aria-label="Play the board's history"
		style={{
			...headerButtonStyle,
			color: canPlay ? GUI_THEME.secondary : GUI_THEME.dim,
			cursor: canPlay ? 'pointer' : 'default',
			opacity: canPlay ? 1 : 0.4,
		}}
	>
		<IconPlay size={13} />
	</button>
);

// Deliberately one block spanning both charts and the gap: hovering a commit
// lights up the same day in the issue track above, which is what makes the two
// halves read as one time grid.
