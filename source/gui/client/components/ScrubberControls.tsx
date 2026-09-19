// The row of controls above the chart: what the window covers, where the
// needle steps to next, which panels are open, and the button that plays the
// whole thing back. Presentational — props in, JSX out; the state behind them
// is TimeScrubber's.

import {GUI_THEME} from '../lib/gui-theme';
import {
	isPeriodWindow,
	LayoutMode,
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
import {IconButton, ICON_SIZE} from './IconButton';
import {IconFunnel} from './IconFunnel';
import {IconLive} from './IconLive';
import {IconNow} from './IconNow';
import {IconReplay} from './IconReplay';
import {IconFlow} from './IconFlow';
import {IconLog} from './IconLog';
import {IconTimeline} from './IconTimeline';
import {IconScatter} from './IconScatter';
import {segmentedButtonStyle} from '../lib/segmented.style';
import {selectTriggerStyle} from '../lib/select-style';
import {
	BoardSeriesGroup,
	CommitSeriesGroup,
	mutedStyle,
	ScopeSelect,
} from './ScrubberSelects';

// Borderless, marked the way Tabs marks the open tab. The icon toggles below
// keep their box: they carry no label, so the border is what holds their shape.

// A fixture on this bar: a well the controls that are not about the chart sit
// in — the panel toggles at one end, the transport at the other. Both outlive
// the charts, which is what the well says and what a bare icon among the chart
// buttons did not.
//
// The gap is a sliver of the well's own ground, for a pair of switches in one
// fixture rather than one control with two halves: at a pixel the rounded
// grounds swallow it, past two it stops reading as a pair.
const fixtureWellStyle: React.CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: 2,
	padding: 1,
	borderRadius: 6,
	background: GUI_THEME.panel2,
	// Longhand, because the transport's well turns its colour off and React
	// warns — rightly — about a shorthand and a longhand for the same value
	// meeting on a rerender.
	borderWidth: 1,
	borderStyle: 'solid',
	borderColor: GUI_THEME.line,
};

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

export const ScrubberControls = ({
	connected,
	scope,
	zoomed,
	windowOnly,
	windowFilterable,
	canPlay,
	playTitle,
	onPlay,
	following,
	canFollow,
	followTitle,
	onChangeFollowing,
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
	// The window was dragged out on the chart, so it is none of the periods the
	// scope row lists and a seventh option stands for it instead.
	zoomed: boolean;
	// The board is narrowed to the tickets this window has an event for.
	windowOnly: boolean;
	canPlay: boolean;
	playTitle: string;
	onPlay: () => void;
	// The live half of the transport. Owned above this row, because the log
	// panel reads it too and the board turns it off when the reader reaches for
	// it — three places, so it cannot live in any one of them.
	following: boolean;
	canFollow: boolean;
	followTitle: string;
	onChangeFollowing: (next: boolean) => void;
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
				// Twice the gap the narrowing group keeps within itself, so the
				// breaks between groups read as the wider ones.
				gap: 20,
				// Sized by the bar rather than by what is on it: the text filter is
				// the one control here that gives when the row is tight, and a row
				// sized to its own content would never be tight.
				flex: '1 1 0',
				minWidth: 0,
			}}
		>
			{/* First on the row, ahead of the periods: what the chart is redraws it
			    whole, where a period only says how much of it to show. */}
			<div style={{display: 'flex', gap: 2}}>
				<IconButton
					title="Volume per period"
					aria-label="Volume"
					pressed={layoutMode === 'even'}
					disabled={!connected}
					onClick={() => onChangeLayoutMode('even')}
				>
					<IconBars size={ICON_SIZE} />
				</IconButton>
				<IconButton
					title="Events by moment and time of day"
					aria-label="Events"
					pressed={layoutMode === 'real'}
					disabled={!connected}
					onClick={() => onChangeLayoutMode('real')}
				>
					<IconScatter size={ICON_SIZE} />
				</IconButton>
				<IconButton
					title="Flow between swimlanes, one line per ticket"
					aria-label="Flow"
					pressed={layoutMode === 'flow'}
					disabled={!connected}
					onClick={() => onChangeLayoutMode('flow')}
				>
					<IconFlow size={ICON_SIZE} />
				</IconButton>
			</div>

			<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
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
									...segmentedButtonStyle(
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
				    its left. It sits at the end of this group because it is not a
				    period on the same scale as the rest.

				    Faded rather than unmounted: the row must not shift by its width
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
								...segmentedButtonStyle(zoomed && !ticketFocus),
								opacity: zoomed && !ticketFocus ? 1 : 0.35,
								cursor: 'default',
							}}
						>
							Zoom
						</button>
					</div>
				)}
			</div>

			{/* The row's slack, so the two controls that draw the chart sit at its
			    left end and everything that narrows the board at its right. */}
			<div aria-hidden style={{flex: '1 1 0', minWidth: 0}} />

			<div
				style={{
					display: 'flex',
					// A touch closer than the row's own gap: this is one group of
					// narrowings, and it is the row's widest at a laptop's width.
					gap: 10,
					alignItems: 'center',
					// Shrinkable past its content, which is what lets the text filter
					// in it give way on a tight row; nothing else in here can.
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

				<TextFilterInput value={textFilter} onChange={onChangeTextFilter} />

				{/* Last of the narrowings, past the series pickers and the query
			    rather than off by the scope row, so they are all in one place.
			    The window it narrows to is the one those buttons select — under
			    "All" that is every event there is, which narrows nothing, so it
			    goes flat instead of pretending to. */}
				<SpotlightToggle
					title={
						ticketFocus
							? 'Already narrowed to a ticket'
							: everythingInScope
							? 'Pick a period first'
							: !windowFilterable
							? 'Too many events to tell tickets apart'
							: 'Narrow board to timeline window'
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
			</div>

			{/* Last on the row, past everything that draws or narrows the window:
			    the transport is the one thing here that starts something.
			    
			    Its two halves are one group and keep the narrowing group's own
			    gap rather than the row's, which is deliberately twice that so the
			    breaks *between* groups read as the wider ones. Live and play are
			    the same question — the present or the past — and spacing them
			    like two groups says they are two. */}
			<span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
				<LiveToggle
					following={following}
					disabled={!canFollow}
					title={followTitle}
					onChange={onChangeFollowing}
				/>

				<ScrubberPlayButton
					canPlay={canPlay}
					playTitle={playTitle}
					onPlay={onPlay}
				/>
			</span>
		</div>
	);
};

// The board narrowed to the tickets with activity in the timeline's window.
// Wears the funnel, the same mark the ticket panel's narrowing wears: both are
// filters, they are never on one row, and this one goes flat while that one is
// on. Drawn once, since the collapsed header puts the same one up when the
// rest of the row is not on screen.
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
	<IconButton
		testId="spotlight"
		title={title}
		aria-label="Narrow board to timeline window"
		pressed={on}
		disabled={disabled}
		onClick={() => onChange(!on)}
	>
		<IconFunnel size={ICON_SIZE} />
	</IconButton>
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
			...fixtureWellStyle,
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
		<IconButton
			testId="log-toggle"
			title={logOpen ? 'Hide the event log' : 'Show the event log'}
			pressed={logOpen}
			onClick={() => onChangeLogOpen(!logOpen)}
		>
			<IconLog size={ICON_SIZE} />
		</IconButton>

		{/* Marked with the thing it opens, as its neighbour is, and lit the same
		    way while it is open — a chevron said only "there is more here", which
		    is true of every disclosure on the page. */}
		<IconButton
			testId="timeline-toggle"
			title={collapsed ? 'Show time travel' : 'Hide time travel'}
			pressed={!collapsed}
			aria-expanded={!collapsed}
			onClick={onToggleCollapsed}
		>
			<IconTimeline size={ICON_SIZE} />
		</IconButton>
	</div>
);

// The way back from history, standing at the end of the track — which is where
// pressing it puts the needle. On the bar it was a button that described a
// place; here it *is* the place, and the press reads as "put it back there"
// rather than as a command to be taken on trust.
//
// Only while the board is parked. Live it would sit over the newest bars saying
// nothing, and the needle is already at that end.
export const ReturnToNowButton = ({
	isScrubbing,
	onReturnToLive,
}: {
	isScrubbing: boolean;
	onReturnToLive: () => void;
}) => {
	if (!isScrubbing) return null;

	return (
		<button
			onClick={onReturnToLive}
			// The track beneath owns pointer capture and reads a press as the
			// start of a scrub. Without this the button both returns to now and
			// scrubs to where it sits, which is a press that undoes itself.
			//
			// And it reads a move as "say what is under the pointer", which put the
			// timeline's own hint over the button instead of the button's. Both are
			// stopped here, the way the pager arrows on this chart already do.
			onPointerDown={event => event.stopPropagation()}
			onMouseMove={event => event.stopPropagation()}
			title="Put the board back at now"
			// Named for the place, not the sentence: the tooltip carries the fuller
			// wording, and every test that drives this button asks for "Now".
			aria-label="Now"
			style={{
				...headerButtonStyle,
				position: 'absolute',
				// Sat against the end of the track, clear of its own edge by the
				// hairline the veil draws there.
				right: 2,
				top: '50%',
				transform: 'translateY(-50%)',
				zIndex: 4,
				background: GUI_THEME.accent,
				border: `1px solid ${GUI_THEME.accent}`,
				color: GUI_THEME.bg,
				display: 'inline-flex',
				alignItems: 'center',
				// The mark alone. On the bar the word did the work of saying where
				// the press led; standing at that place, it only takes width from
				// the chart it is sitting on.
				padding: '3px 4px',
				cursor: 'pointer',
			}}
		>
			<IconNow size={ICON_SIZE} />
		</button>
	);
};

// The live half of the transport, beside the play button that is the other
// half: play walks through what already happened, this rides what is happening.
// A reader asking "am I watching the present or the past" looks in one place
// for the answer, which is the argument for the two being neighbours.
//
// Lit, it wears the accent and says LIVE beside the mark — a mode that moves
// the board on its own has to be legible across a room, not inferred from a
// pressed box.
export const LiveToggle = ({
	following,
	disabled,
	title,
	onChange,
}: {
	following: boolean;
	// Off the present there is nothing to follow: a checkout and a movie both
	// stand somewhere else, and the board is already being driven by them.
	disabled: boolean;
	title: string;
	onChange: (next: boolean) => void;
}) => (
	// An `IconButton` in a well, exactly as the play button beside it is. This
	// was a hand-rolled button once, for the accent fill a quiet one does not
	// have — and paid for it three times over: it came out four pixels smaller
	// than its neighbour, answered a pointer with no hover at all, and had to be
	// given each of those back by hand. The fill is a tone on the shared
	// component now, so everything else comes with it.
	<span
		style={{
			...fixtureWellStyle,
			...(disabled
				? {background: 'transparent', borderColor: 'transparent'}
				: {}),
		}}
	>
		<IconButton
			testId="live-toggle"
			title={title}
			aria-label="Follow the newest event"
			pressed={following}
			disabled={disabled}
			tone="solid"
			// Only while it is lit does the word appear, so an idle bar keeps the
			// width of a button rather than of a label nobody needs yet.
			label={following ? 'LIVE' : undefined}
			onClick={() => onChange(!following)}
		>
			<IconLive size={ICON_SIZE} lit={following} />
		</IconButton>
	</span>
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
	// In the same well as the panel toggles at the row's other end: it starts
	// something rather than drawing the chart, and it is on the bar whether the
	// charts are up or shut.
	//
	// The well goes when it cannot be pressed, as the Resume slot's does: a
	// panel and a border around a button that does nothing reads as a control
	// that has stopped working. The box is kept either way, so an unplayable
	// window does not shift the row.
	<span
		style={{
			...fixtureWellStyle,
			...(canPlay
				? {}
				: {background: 'transparent', borderColor: 'transparent'}),
		}}
	>
		<IconButton
			testId="theatre-play"
			title={playTitle}
			aria-label="Play the board's history"
			disabled={!canPlay}
			onClick={onPlay}
		>
			<IconReplay size={ICON_SIZE} />
		</IconButton>
	</span>
);

// Deliberately one block spanning both charts and the gap: hovering a commit
// lights up the same day in the issue track above, which is what makes the two
// halves read as one time grid.
