// The controls row above the chart. Presentational; TimeScrubber owns the state.

import {useRef} from 'react';
import {GUI_THEME, SANS_FONT} from '../lib/gui-theme';
import {useGlowGradient} from './Panel';
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
import {DensitySwitch} from './DensitySwitch';
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
import {fixtureWellStyle} from '../lib/segmented.style';

// Borderless, marked the way Tabs marks the open tab. The icon toggles below
// keep their box: they carry no label, so the border is what holds their shape.

// Panel toggles and transport share one quiet style, cornered as chrome.
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
	linesMeasure,
	onChangeLinesMeasure,
	commitRepos,
	hiddenCommitRepos,
	onToggleCommitRepo,
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
	// Live follow, owned above: the log panel reads it and the board turns it off.
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
	// What the Code series' bars measure, as against which commits they count.
	linesMeasure: boolean;
	onChangeLinesMeasure: (next: boolean) => void;
	// Which repos the Code series plots, when its commits come from several.
	commitRepos: readonly string[];
	hiddenCommitRepos: ReadonlySet<string>;
	onToggleCommitRepo: (repo: string) => void;
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
				// Either side of the line between two groups, so a break is twice
				// this and a line: more where the window has the room.
				gap: 'clamp(12px, 1.4vw, 22px)',
				// Sized by the bar, so the text filter gives when the row is tight.
				flex: '1 1 0',
				minWidth: 0,
			}}
		>
			{/* First on the row, ahead of the periods: what the chart is redraws it
			    whole, where a period only says how much of it to show. */}
			<LabelledGroup label="Graph" style={{gap: 2}}>
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
			</LabelledGroup>

			<GroupDivider />

			{/* How the board's own cards are drawn, beside how the chart is. */}
			<LabelledGroup label="Cards">
				<DensitySwitch disabled={!connected} />
			</LabelledGroup>

			<GroupDivider />

			<LabelledGroup label="Scope">
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

						{/* Shows a zoom, never makes one: zoom by dragging on the chart, leave by
						    picking a period. Faded rather than unmounted, so the row doesn't shift. */}
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
			</LabelledGroup>

			<GroupDivider />

			{/* Holds the board to the window; flat under "All", which narrows nothing. */}
			<LabelledGroup label="Narrow">
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
					// Needs no socket, so it can be let go of offline but not taken up. Flat
					// under the ticket narrowing, which already leaves one card.
					disabled={
						ticketFocus ||
						everythingInScope ||
						!windowFilterable ||
						(!connected && !windowOnly)
					}
					onChange={onChangeWindowOnly}
				/>
			</LabelledGroup>

			{/* The row's slack, between the window controls and the pickers. */}
			<div aria-hidden style={{flex: '1 1 0', minWidth: 0}} />

			<LabelledGroup
				label="Filter"
				style={{
					// A touch closer than the row's own gap: this is one group of
					// narrowings, and it is the row's widest at a laptop's width.
					gap: 10,
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
					linesMeasure={linesMeasure}
					repos={commitRepos}
					hiddenRepos={hiddenCommitRepos}
					onChangeShowCommits={onChangeShowCommits}
					onChangeLinkedOnly={onChangeLinkedCommitsOnly}
					onChangeLinesMeasure={onChangeLinesMeasure}
					onToggleRepo={onToggleCommitRepo}
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
			</LabelledGroup>

			<GroupDivider />

			{/* Last: the transport. */}
			<LabelledGroup label="Live">
				<LiveToggle
					following={following}
					disabled={!canFollow}
					title={followTitle}
					onChange={onChangeFollowing}
				/>
			</LabelledGroup>

			<LabelledGroup label="Replay">
				<ScrubberPlayButton
					canPlay={canPlay}
					playTitle={playTitle}
					onPlay={onPlay}
				/>
			</LabelledGroup>
		</div>
	);
};

// A hairline between groups, lit by the panel's glow like its border.
const GroupDivider = () => {
	const ref = useRef<HTMLSpanElement>(null);
	const {glow, gradient} = useGlowGradient(ref);

	return (
		<span
			ref={ref}
			aria-hidden
			style={{
				position: 'relative',
				alignSelf: 'center',
				width: 1,
				height: GROUP_DIVIDER_HEIGHT,
				flexShrink: 0,
				background: GUI_THEME.line,
			}}
		>
			<span
				style={{
					position: 'absolute',
					inset: 0,
					background: gradient,
					opacity: glow.strength * glow.opacity,
					transition: 'opacity 140ms ease',
				}}
			/>
		</span>
	);
};

// As tall as a row's controls, not the row: the group names sit above them.
const GROUP_DIVIDER_HEIGHT = 22;

// A named group. The name hangs out of flow in the panel's top padding, lit by
// the panel's glow.
const LabelledGroup = ({
	label,
	style,
	children,
}: {
	label: string;
	style?: React.CSSProperties;
	children: React.ReactNode;
}) => {
	const labelRef = useRef<HTMLSpanElement>(null);
	const {glow, gradient} = useGlowGradient(labelRef);

	return (
		<div
			data-group-label={label}
			style={{
				position: 'relative',
				display: 'flex',
				alignItems: 'center',
				alignSelf: 'stretch',
				...style,
			}}
		>
			<span
				ref={labelRef}
				aria-hidden
				style={{
					position: 'absolute',
					left: 0,
					bottom: '100%',
					marginBottom: 4,
					fontFamily: SANS_FONT,
					fontSize: 8,
					lineHeight: 1,
					letterSpacing: '0.1em',
					textTransform: 'uppercase',
					whiteSpace: 'nowrap',
					pointerEvents: 'none',
					userSelect: 'none',
				}}
			>
				{/* Two copies side by side, so the faint one's opacity doesn't cap the lit one. */}
				<span style={{color: GUI_THEME.dim, opacity: 0.6}}>{label}</span>
				{/* The lit copy over the faint one, the glow's gradient clipped to
				    its letters, fading in and out on the border's own clock. */}
				<span
					style={{
						position: 'absolute',
						inset: 0,
						color: 'transparent',
						backgroundImage: gradient,
						WebkitBackgroundClip: 'text',
						backgroundClip: 'text',
						opacity: glow.strength,
						transition: 'opacity 140ms ease',
					}}
				>
					{label}
				</span>
			</span>
			{children}
		</div>
	);
};

// Narrows the board to tickets active in the window. Goes flat while the
// ticket narrowing is on.
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

// The board's text query, styled like the row's selects and lit while it holds
// one. Escape clears it and blurs.
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
			placeholder="Ref or title"
			aria-label="Filter tickets by ref or title"
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
				// The one control that shrinks, so the transport isn't pushed off the edge.
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
		{/* Opens the side panel. Here so it survives the bar collapsing; needs no socket. */}
		<IconButton
			testId="log-toggle"
			title={logOpen ? 'Hide the event log' : 'Show the event log'}
			pressed={logOpen}
			onClick={() => onChangeLogOpen(!logOpen)}
		>
			<IconLog size={ICON_SIZE} />
		</IconButton>

		{/* Marked with what it opens, and lit while open. */}
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

// Back to the present, standing at the track's end where it puts the needle.
// Only while the board is parked.
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
			// Stops the track behind from scrubbing or hinting on this press.
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
				// The mark alone; the word only took width from the chart.
				padding: '3px 4px',
				cursor: 'pointer',
			}}
		>
			<IconNow size={ICON_SIZE} />
		</button>
	);
};

// Follow live, beside play. Lit with an accent fill; its group's name is its label.
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
	// The accent fill is a tone of the shared IconButton.
	<IconButton
		testId="live-toggle"
		title={title}
		aria-label="Follow the newest event"
		pressed={following}
		disabled={disabled}
		tone="solid"
		onClick={() => onChange(!following)}
	>
		<IconLive size={ICON_SIZE} lit={following} />
	</IconButton>
);

// The transport: in the controls while open, beside the collapsed row when shut.
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
	// A plain `IconButton`, the size of every other single icon on the row.
	<IconButton
		testId="theatre-play"
		title={playTitle}
		aria-label="Play the board's history"
		disabled={!canPlay}
		onClick={onPlay}
	>
		<IconReplay size={ICON_SIZE} />
	</IconButton>
);

// One block across both charts and the gap, so the two read as one time grid.
