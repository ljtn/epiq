// Every piece of the time scrubber's markup. Presentational only: props in,
// JSX out, no state but the needle's own hover. TimeScrubber owns the data and
// arranges these; the maths they draw against lives in lib/scrubber.

import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {
	barGrowAnimation,
	BAR_ENTRANCE_TOTAL_MS,
	barWidthCss,
	BUCKET_HIGHLIGHT_COLOR,
	clamp,
	DOT_EXIT_TOTAL_MS,
	dotEntranceScale,
	dotExitScale,
	EVENTS_MODE_VERTICAL_PADDING,
	EVENTS_SCATTER_HEIGHT,
	FADE_IN_ANIMATION,
	formatPeriodLabel,
	HOVER_HINT_WIDTH,
	isPeriodWindow,
	LayoutMode,
	NEEDLE_COLOR,
	NEEDLE_GRIP_WIDTH,
	PeriodRange,
	RANGE_SELECTION_COLOR,
	RANGE_SELECTION_EDGE,
	Scope,
	scopeButtonLabel,
	SCOPES,
	Segment,
	BOARD_VIEWS,
	boardViewColor,
	soleVisibleIdentity,
	identityAxisFor,
	BoardView,
	EventCategory,
	SEGMENT_HIGHLIGHT_COLOR,
	TRACK_HEIGHT,
	VolumeBar,
} from '../lib/scrubber';
import {GuiEventIdentity} from '../lib/gui-state.model';
import {Checkbox} from './Checkbox';
import {IconBars} from './IconBars';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';
import {IconScatter} from './IconScatter';

// Named once: the collapsed header puts the same box up when the rest of this
// row is not on screen.
export const SCOPE_ONLY_LABEL = 'Scope only';
export const TICKET_ONLY_LABEL = 'This ticket';

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

// What every control wears while the socket is down.
const mutedStyle: React.CSSProperties = {
	opacity: 0.4,
	cursor: 'not-allowed',
};

const iconToggleButtonStyle = (active: boolean): React.CSSProperties => ({
	...toggleButtonStyle(active),
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	padding: '3px 7px',
});

// Nouns, not gerunds: these name what is plotted, and they double as the labels
// on the identity lists underneath ("Tags" over a list of tags).
const CATEGORY_LABELS: Record<EventCategory, string> = {
	tickets: 'Tickets',
	comments: 'Comments',
	tagging: 'Tags',
	assigning: 'Assignees',
};

// Bright enough to read as part of the control. At GUI_THEME.dim it sat so
// faint beside its label that the collapsed panel looked like it had no
// disclosure at all.
const disclosureStyle: React.CSSProperties = {
	background: 'transparent',
	border: 'none',
	padding: 0,
	display: 'inline-flex',
	alignItems: 'center',
	color: GUI_THEME.secondary,
	cursor: 'pointer',
};

// "All board events" rather than "All": as the collapsed trigger it is the only
// thing naming the series, and a bare "All" two controls from "All boards" says
// nothing about which is which.
const VIEW_LABELS: Record<BoardView, string> = {
	all: 'All board events',
	...CATEGORY_LABELS,
};

// Fixed, not sized to its label: the selection changes as the thing is used,
// and a trigger that grew with it would shove the scope buttons beside it out
// from under the pointer. Wide enough for "Assignees: <a long name>".
const SELECT_TRIGGER_WIDTH = 180;

// A select. Filled rather than outlined, unlike the toggles beside it: it is the
// only control here reporting a colour, and an outline in that colour drowned
// out the text carrying it. The fill also separates a thing you open from the
// things you switch.
const selectTriggerStyle = (
	color: string,
	disabled: boolean,
): React.CSSProperties => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	gap: 6,
	width: SELECT_TRIGGER_WIDTH,
	boxSizing: 'border-box',
	background: 'rgba(208, 223, 255, 0.08)',
	// None, but padded as though there were, so it sits at the same height as
	// the bordered toggles on either side.
	border: 'none',
	color: disabled ? GUI_THEME.dim : color,
	borderRadius: 6,
	fontFamily: 'inherit',
	fontSize: 10,
	padding: '3px 7px 3px 9px',
	cursor: disabled ? 'not-allowed' : 'pointer',
	opacity: disabled ? 0.4 : 1,
});

const nestedListStyle: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: 7,
	marginLeft: 5,
	paddingLeft: 8,
	borderLeft: `1px solid ${GUI_THEME.line}`,
};

// Floated rather than in flow: the controls sit directly above the chart, and
// a tree that grew the row would shove the very thing being filtered downward.
const popoverStyle: React.CSSProperties = {
	position: 'absolute',
	top: '100%',
	left: 0,
	marginTop: 6,
	// Carries the column and its gap itself. Without them the options stack as
	// plain blocks and their radios sit edge to edge.
	display: 'flex',
	flexDirection: 'column',
	gap: 7,
	padding: '10px 14px 10px 10px',
	// Sized for the common case up front, so opening a kind with a list does
	// not visibly widen the panel under the pointer.
	minWidth: 200,
	// Slightly sheer over a blur, so the chart it filters stays legible beneath
	// it rather than being covered outright.
	background: 'rgba(21, 26, 36, 0.88)',
	backdropFilter: 'blur(12px)',
	WebkitBackdropFilter: 'blur(12px)',
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 8,
	boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
	// Above the dots and the needle, which sit at 1 and 2.
	zIndex: 30,
	whiteSpace: 'nowrap',
};

const onlyButtonStyle: React.CSSProperties = {
	background: 'transparent',
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 4,
	color: GUI_THEME.dim,
	fontFamily: 'inherit',
	fontSize: 9,
	lineHeight: 1,
	padding: '2px 4px',
	cursor: 'pointer',
};

// Closes on a click anywhere else, which is the half of "dropdown" that a bare
// toggle leaves out.
const useDismissOnOutsideClick = (
	open: boolean,
	onDismiss: () => void,
): React.RefObject<HTMLDivElement | null> => {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;

		const onPointerDown = (event: MouseEvent) => {
			if (!ref.current?.contains(event.target as Node)) onDismiss();
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onDismiss();
		};

		document.addEventListener('mousedown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);

		return () => {
			document.removeEventListener('mousedown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [open, onDismiss]);

	return ref;
};

// Drawn as a dot rather than a box, so a row picking one of several kinds never
// reads as a box that could be ticked alongside its siblings.
const Radio = ({
	label,
	selected,
	color,
	disabled,
	onSelect,
}: {
	label: string;
	selected: boolean;
	color: string;
	disabled?: boolean;
	onSelect: () => void;
}) => (
	<button
		type="button"
		role="radio"
		aria-checked={selected}
		disabled={disabled}
		onClick={onSelect}
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 5,
			background: 'transparent',
			border: 'none',
			padding: 0,
			fontSize: 10,
			fontFamily: 'inherit',
			color: selected ? color : GUI_THEME.dim,
			cursor: disabled ? 'not-allowed' : 'pointer',
			opacity: disabled ? 0.4 : 1,
		}}
	>
		<span
			style={{
				width: 12,
				height: 12,
				borderRadius: '50%',
				border: `1px solid ${selected ? color : GUI_THEME.dim}`,
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				flexShrink: 0,
			}}
		>
			{selected && (
				<span
					style={{
						width: 6,
						height: 6,
						borderRadius: '50%',
						background: color,
					}}
				/>
			)}
		</span>
		{label}
	</button>
);

// A checkbox for the series and a select for what it draws, one kind at a time.
// That is what lets a colour mean one thing: "All board events" colours by kind,
// and any single kind colours by the tag or person behind each event, never both
// at once. The trigger reads back whatever is selected, down to the one tag or
// person left when the rest are unticked — the same name and colour the bars and
// dots are then drawn in.
const BoardSeriesGroup = ({
	connected,
	showIssues,
	view,
	identities,
	hiddenIds,
	expanded,
	identitiesExpanded,
	filtered,
	onChangeShowIssues,
	onChangeView,
	onToggleIdentity,
	onOnlyIdentity,
	onToggleExpanded,
	onSetIdentitiesExpanded,
}: {
	connected: boolean;
	showIssues: boolean;
	view: BoardView;
	// What the current window actually holds, so the list is a legend for what
	// is on screen rather than a catalogue of the whole repo.
	identities: GuiEventIdentity[];
	hiddenIds: ReadonlySet<string>;
	expanded: boolean;
	identitiesExpanded: boolean;
	filtered: boolean;
	onChangeShowIssues: (next: boolean) => void;
	onChangeView: (view: BoardView) => void;
	onToggleIdentity: (id: string, next: boolean) => void;
	onOnlyIdentity: (id: string) => void;
	onToggleExpanded: () => void;
	onSetIdentitiesExpanded: (next: boolean) => void;
}) => {
	// Down to one tag or person, that identity *is* the series, so it gives the
	// trigger its name and its colour. Several hidden and no single colour would
	// be honest, so the trigger only says that it is narrowed.
	const sole = soleVisibleIdentity(identities, hiddenIds);
	const partial =
		filtered && hiddenIds.size > 0 && identityAxisFor(view) !== null;

	const label = sole
		? `${VIEW_LABELS[view]}: ${sole.name}`
		: partial
		? `${VIEW_LABELS[view]} (multi)`
		: VIEW_LABELS[view];

	const color =
		sole?.color ?? (partial ? GUI_THEME.dim2 : boardViewColor(view));

	// Where the server capped the window its buckets are pre-summed across every
	// kind, so nothing in here is selectable. The select still opens — the greyed
	// options are what says why, and a dead trigger would not.
	const ref = useDismissOnOutsideClick(expanded, onToggleExpanded);

	return (
		<div
			ref={ref}
			style={{position: 'relative', display: 'flex', flexDirection: 'column'}}
		>
			<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
				{/* Unlabelled: the select beside it already names the series, and a
				    second copy of the name would only compete with it. */}
				<Checkbox
					label={null}
					title="Show board events"
					checked={showIssues}
					activeColor={color}
					disabled={!connected}
					onChange={onChangeShowIssues}
				/>
				<button
					type="button"
					onClick={onToggleExpanded}
					disabled={!showIssues || !connected}
					title={
						filtered
							? 'Choose what the board series plots'
							: 'This window holds too many events to split by kind'
					}
					aria-haspopup="listbox"
					aria-expanded={expanded}
					style={{
						...selectTriggerStyle(color, !showIssues),
						...(connected ? {} : mutedStyle),
					}}
				>
					{/* Clipped rather than wrapped: a tag name long enough to overflow
					    is still recognisable from its start, and the open list spells it
					    out in full. No title of its own — the button's explains more. */}
					<span
						style={{
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{label}
					</span>
					<span style={{display: 'inline-flex', flexShrink: 0}}>
						<IconChevronDown size={12} />
					</span>
				</button>
			</div>

			{expanded && (
				<div role="radiogroup" style={popoverStyle}>
					{BOARD_VIEWS.map(option => {
						const selected = view === option;
						// Drawn from the view alone, not from whether a list has been
						// loaded for it: only the selected view has its identities to
						// hand, and hiding the caret until then made every other row
						// look like it had nothing under it.
						const hasList = identityAxisFor(option) !== null;
						const open = selected && identitiesExpanded;

						return (
							<div
								key={option}
								style={{display: 'flex', flexDirection: 'column', gap: 7}}
							>
								<div style={{display: 'flex', alignItems: 'center', gap: 3}}>
									<Radio
										label={VIEW_LABELS[option]}
										selected={selected}
										color={boardViewColor(option)}
										disabled={!showIssues || !filtered}
										onSelect={() => onChangeView(option)}
									/>
									{hasList && (
										<button
											type="button"
											disabled={!showIssues || !filtered}
											// From an unselected row this both selects and opens,
											// which is the one thing anyone wants from a caret on a
											// row that is not current.
											onClick={() => {
												if (!selected) onChangeView(option);
												onSetIdentitiesExpanded(!open);
											}}
											title={open ? 'Hide the list' : 'Pick which to show'}
											aria-expanded={open}
											style={disclosureStyle}
										>
											{open ? (
												<IconChevronDown size={12} />
											) : (
												<IconChevronRight size={12} />
											)}
										</button>
									)}
								</div>

								{open && identities.length > 0 && (
									<div
										style={{
											...nestedListStyle,
											// A repo with dozens of tags would otherwise push the
											// board itself off the screen.
											maxHeight: 132,
											overflowY: 'auto',
										}}
									>
										{identities.map(identity => (
											<div
												key={identity.id}
												style={{
													display: 'flex',
													alignItems: 'center',
													justifyContent: 'space-between',
													gap: 10,
												}}
											>
												<Checkbox
													label={identity.name}
													checked={!hiddenIds.has(identity.id)}
													activeColor={identity.color}
													disabled={!showIssues}
													onChange={next => onToggleIdentity(identity.id, next)}
												/>
												<button
													type="button"
													title={`Show only ${identity.name}`}
													disabled={!showIssues}
													onClick={() => onOnlyIdentity(identity.id)}
													style={onlyButtonStyle}
												>
													only
												</button>
											</div>
										))}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

const navButtonStyle: React.CSSProperties = {
	background: 'transparent',
	border: `1px solid ${GUI_THEME.dim}`,
	color: GUI_THEME.dim,
	borderRadius: 6,
	fontSize: 10,
	padding: '2px 6px',
	cursor: 'pointer',
	lineHeight: 1,
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
	ticketOnly,
	ticketSelected,
	ticketFocus,
	layoutMode,
	showIssues,
	showCommits,
	allBoards,
	boardView,
	identities,
	hiddenIdentityIds,
	categoriesExpanded,
	identitiesExpanded,
	categoriesFiltered,
	isScrubbing,
	onReturnToLive,
	onChangeScope,
	onChangeOffset,
	onChangeWindowOnly,
	onChangeTicketOnly,
	onChangeLayoutMode,
	onChangeShowIssues,
	onChangeShowCommits,
	onChangeAllBoards,
	onChangeBoardView,
	onToggleIdentity,
	onOnlyIdentity,
	onToggleCategoriesExpanded,
	onSetIdentitiesExpanded,
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
	// False where the window came back as counts alone, naming no tickets to
	// narrow to.
	windowFilterable: boolean;
	// The chart is narrowed to the open ticket: its window, and its events only.
	ticketOnly: boolean;
	// Whether there is a ticket to narrow to at all.
	ticketSelected: boolean;
	// Both of the above — the narrowing is actually in force.
	ticketFocus: boolean;
	layoutMode: LayoutMode;
	showIssues: boolean;
	showCommits: boolean;
	allBoards: boolean;
	boardView: BoardView;
	identities: GuiEventIdentity[];
	hiddenIdentityIds: ReadonlySet<string>;
	categoriesExpanded: boolean;
	identitiesExpanded: boolean;
	// False where the server capped the window: the buckets it fell back to are
	// pre-summed across every kind, so there is nothing to filter.
	categoriesFiltered: boolean;
	isScrubbing: boolean;
	onReturnToLive: () => void;
	onChangeScope: (scope: Scope) => void;
	onChangeOffset: (offset: number) => void;
	onChangeWindowOnly: (next: boolean) => void;
	onChangeTicketOnly: (next: boolean) => void;
	onChangeLayoutMode: (mode: LayoutMode) => void;
	onChangeShowIssues: (next: boolean) => void;
	onChangeShowCommits: (next: boolean) => void;
	onChangeAllBoards: (next: boolean) => void;
	onChangeBoardView: (view: BoardView) => void;
	onToggleIdentity: (id: string, next: boolean) => void;
	onOnlyIdentity: (id: string) => void;
	onToggleCategoriesExpanded: () => void;
	onSetIdentitiesExpanded: (next: boolean) => void;
}) => {
	const everythingInScope = !isPeriodWindow(scope, zoomed);

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'flex-end',
				gap: 12,
			}}
		>
			<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
				{(scope !== 'all' || zoomed || ticketFocus) && (
					<div style={{display: 'flex', alignItems: 'center', gap: 2}}>
						<button
							title={
								ticketFocus
									? 'The ticket\u2019s own stretch — untick "This ticket" to page'
									: 'Earlier'
							}
							disabled={!connected || ticketFocus}
							onClick={() => onChangeOffset(offset + 1)}
							style={{
								...navButtonStyle,
								...(connected && !ticketFocus ? {} : mutedStyle),
							}}
						>
							◀
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
							style={{
								...navButtonStyle,
								opacity: atLatest || ticketFocus ? 0.35 : 1,
								cursor: atLatest || ticketFocus ? 'default' : 'pointer',
							}}
						>
							▶
						</button>
					</div>
				)}

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
								? 'Held behind the ticket’s own stretch — untick "This ticket" to come back to it'
								: zoomed
								? 'A window dragged out on the chart — pick a period to leave it'
								: 'Drag across the chart to zoom the window to a stretch of it'
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
			</div>

			<div style={{display: 'flex', gap: 2}}>
				<button
					title="Volume — how much happened, per equal-width period, with no empty gaps for quiet stretches"
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
					title="Events — individual events by exact moment, x is elapsed time and y is time of day"
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
			</div>

			<div style={{display: 'flex', gap: 12, alignItems: 'center'}}>
				<Checkbox
					label="Code"
					checked={showCommits}
					activeColor={GUI_THEME.green}
					disabled={!connected}
					onChange={onChangeShowCommits}
				/>
				<BoardSeriesGroup
					connected={connected}
					showIssues={showIssues}
					view={boardView}
					identities={identities}
					hiddenIds={hiddenIdentityIds}
					expanded={categoriesExpanded}
					identitiesExpanded={identitiesExpanded}
					filtered={categoriesFiltered}
					onChangeShowIssues={onChangeShowIssues}
					onChangeView={onChangeBoardView}
					onToggleIdentity={onToggleIdentity}
					onOnlyIdentity={onOnlyIdentity}
					onToggleExpanded={onToggleCategoriesExpanded}
					onSetIdentitiesExpanded={onSetIdentitiesExpanded}
				/>

				{/* Beside the series checkboxes rather than by the scope row, so every
			    narrowing on this bar is in one place. The window it names is the
			    one those buttons select — under "All" that is every event there
			    is, which narrows nothing, so it goes flat instead of pretending
			    to. */}
				<Checkbox
					label={SCOPE_ONLY_LABEL}
					title={
						ticketFocus
							? 'The board is already down to one ticket — untick "This ticket" to narrow by window instead'
							: everythingInScope
							? 'Every event is in scope — pick a period to narrow the board'
							: !windowFilterable
							? 'Too many events in this window to tell which tickets they belong to'
							: 'Show only tickets with activity in the selected window'
					}
					checked={windowOnly}
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

				{/* Its own narrowing rather than a seventh scope: a scope names a
			    period, and this names a period *and* whose events survive it.
			    Greyed rather than unmounted with no ticket open, so the row does
			    not change width every time the details panel opens and closes.

			    Not gated on windowFilterable the way its neighbour is: that
			    describes the window on screen, and this one replaces it. Once the
			    ticket's own stretch comes back the title says so if it, too, came
			    back as counts alone. */}
				<Checkbox
					label={TICKET_ONLY_LABEL}
					title={
						!ticketSelected
							? 'Open a ticket to narrow the timeline to it'
							: ticketFocus && !windowFilterable
							? 'Too many events in this stretch to tell which are the ticket\u2019s'
							: 'Narrow to this ticket: the stretch it has existed for, and only its events'
					}
					checked={ticketOnly}
					// Like its neighbour it asks the socket for nothing it cannot
					// already draw, so offline it can still be let go of.
					disabled={!ticketSelected || (!connected && !ticketOnly)}
					onChange={onChangeTicketOnly}
				/>

				{/* <Checkbox
				label="All boards"
				checked={allBoards}
				activeColor={GUI_THEME.accent}
				onChange={onChangeAllBoards}
			/> */}
			</div>

			{/* Present while live too, as the status of the board rather than a way
		    back to it, so entering history never resizes the row.

		    "Now" only over a window that runs up to the present, though. It sits
		    at the end of the row, above the end of the track, so it reads as
		    naming that end — and over a window paged back or dragged out, that
		    end is not now. "Resume" is unaffected: it is an action, not a claim
		    about the far end. The slot holds its width either way. */}
			<button
				onClick={onReturnToLive}
				disabled={!isScrubbing}
				title={
					isScrubbing ? 'Leave history and follow the board again' : undefined
				}
				style={{
					background: 'transparent',
					border: `1px solid ${
						isScrubbing ? GUI_THEME.accent : GUI_THEME.transparent
					}`,
					color: isScrubbing ? GUI_THEME.accent : GUI_THEME.dim,
					borderRadius: 6,
					fontFamily: 'inherit',
					width: 60,
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: isScrubbing ? 'center' : 'flex-end',
					fontSize: 10,
					padding: '2px 8px',
					cursor: isScrubbing ? 'pointer' : 'default',
					whiteSpace: 'nowrap',
					flexShrink: 0,
				}}
			>
				{isScrubbing ? 'Resume' : atLatest ? 'Now' : ''}
			</button>
		</div>
	);
};

export const ScrubberHeader = ({
	collapsed,
	onToggleCollapsed,
}: {
	collapsed: boolean;
	onToggleCollapsed: () => void;
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
		<button
			onClick={onToggleCollapsed}
			title={collapsed ? 'Show time travel' : 'Hide time travel'}
			aria-label={collapsed ? 'Show time travel' : 'Hide time travel'}
			aria-expanded={!collapsed}
			style={{
				background: GUI_THEME.panel2,
				border: `1px solid ${GUI_THEME.line}`,
				borderRadius: 6,
				color: GUI_THEME.secondary,
				padding: '3px 7px',
				cursor: 'pointer',
				display: 'inline-flex',
				alignItems: 'center',
			}}
		>
			{collapsed ? (
				<IconChevronRight size={14} />
			) : (
				<IconChevronDown size={14} />
			)}
		</button>
	</div>
);

// Deliberately one block spanning both charts and the gap: hovering a commit
// lights up the same day in the issue track above, which is what makes the two
// halves read as one time grid.
export const SegmentHighlight = ({
	segment,
	fractionForTime,
}: {
	segment: Segment;
	fractionForTime: (time: number) => number;
}) => {
	const left = fractionForTime(segment.start);

	return (
		<div
			style={{
				position: 'absolute',
				left: `${left * 100}%`,
				width: `${(fractionForTime(segment.end) - left) * 100}%`,
				top: 0,
				bottom: 0,
				background: SEGMENT_HIGHLIGHT_COLOR,
				pointerEvents: 'none',
				display: 'flex',
				justifyContent: 'center',
				paddingTop: 3,
				// With top and bottom both pinned, content-box would add the padding
				// on top of the resolved height and push the block past the wrapper
				// it spans.
				boxSizing: 'border-box',
				fontSize: 9,
				color: GUI_THEME.dim2,
				whiteSpace: 'nowrap',
				// The label is wider than its block at month and year scopes; only
				// one segment is ever highlighted, so it has nothing to overlap.
				overflow: 'visible',
			}}
		>
			{segment.label}
		</div>
	);
};

// The stretch a range drag has covered so far. Spans both charts and the gap,
// like the segment highlight, because the window it will zoom to is one window
// over both series.
export const RangeSelection = ({from, to}: {from: number; to: number}) => {
	const left = Math.min(from, to);

	return (
		<div
			data-testid="scrubber-range-selection"
			style={{
				position: 'absolute',
				left: `${left * 100}%`,
				width: `${Math.abs(to - from) * 100}%`,
				top: 0,
				bottom: 0,
				background: RANGE_SELECTION_COLOR,
				borderLeft: `1px solid ${RANGE_SELECTION_EDGE}`,
				borderRight: `1px solid ${RANGE_SELECTION_EDGE}`,
				boxSizing: 'border-box',
				pointerEvents: 'none',
				// Over the needle: the needle marks where the board is, the selection
				// what is about to replace the whole window.
				zIndex: 4,
			}}
		/>
	);
};

// The baseline every series is drawn against.
export const TrackBaseline = ({
	color,
	anchor,
}: {
	color: string;
	anchor: 'centre' | 'bottom' | 'top';
}) => (
	<div
		style={{
			position: 'absolute',
			left: 0,
			right: 0,
			...(anchor === 'bottom' ? {bottom: 0} : {}),
			...(anchor === 'top' ? {top: 0} : {}),
			height: anchor === 'top' ? 1 : 2,
			borderRadius: 999,
			background: color,
			// The centre line runs through the scatter's dots, so it sits a shade
			// fainter than the edge-anchored baselines.
			opacity: anchor === 'centre' ? 0.14 : 0.2,
		}}
	/>
);

// Absolute positioning ignores the track's padding, so top and bottom add it
// back to line up with the points.
export const HourAxisLabels = () => (
	<>
		{(
			[
				['00:00', {top: EVENTS_MODE_VERTICAL_PADDING}],
				['12:00', {top: '50%', transform: 'translateY(-50%)'}],
				['24:00', {bottom: EVENTS_MODE_VERTICAL_PADDING}],
			] as const
		).map(([label, position]) => (
			<span
				key={label}
				style={{
					position: 'absolute',
					left: 2,
					fontSize: 9,
					color: GUI_THEME.dim,
					pointerEvents: 'none',
					...position,
				}}
			>
				{label}
			</span>
		))}
	</>
);

// The wrapper the entrance fade belongs on, never the individual bars or dots:
// those are keyed by bucket time, so a scope change remounts each one and the
// fade restarts per element as a full-chart flash. Callers key it per series —
// the issue and commit layers are siblings, so a shared key collides and leaves
// stale marks on screen.
export const SeriesLayer = ({
	animate,
	children,
}: {
	animate: boolean;
	children: React.ReactNode;
}) => (
	<div
		style={{
			position: 'absolute',
			inset: 0,
			pointerEvents: 'none',
			animation: animate ? FADE_IN_ANIMATION : undefined,
			// Walls this subtree off from the needle and highlight moving above
			// it: without containment every frame of a drag re-lays-out the
			// thousands of dots inside, and the drag stutters.
			contain: 'layout paint',
		}}
	>
		{children}
	</div>
);

// Shared by the issue histogram and the commit one mirrored below it, so the
// two halves cannot drift apart. Empty buckets draw nothing and stay hoverable
// anyway, since hover is resolved arithmetically rather than by hit target.
// Spans the full track height rather than the bar's, so empty buckets highlight
// too. A sibling of the bars rather than one of them: it moves on every mouse
// move, and the bars — up to MAX_TIME_BUCKETS nodes — must not re-render with
// it.
export const BucketHighlight = ({
	index,
	bucketCount,
}: {
	index: number;
	bucketCount: number;
}) => (
	<div
		style={{
			position: 'absolute',
			left: `${index * (100 / bucketCount)}%`,
			top: 0,
			bottom: 0,
			width: `${100 / bucketCount}%`,
			// A bucket can be thinner than a pixel at wide spans.
			minWidth: 2,
			background: BUCKET_HIGHLIGHT_COLOR,
			pointerEvents: 'none',
		}}
	/>
);

const VolumeBarsImpl = ({
	bars,
	bucketCount,
	firstBar,
	lastBar,
	color,
	direction,
	animate,
}: {
	bars: VolumeBar[];
	bucketCount: number;
	// The populated span, so the growth sweep runs across drawn bars only.
	firstBar: number;
	lastBar: number;
	color: string;
	// "up" is the issue histogram, "down" the mirrored commit one.
	direction: 'up' | 'down';
	animate: boolean;
}) => {
	const widthPercent = 100 / bucketCount;
	const barWidth = barWidthCss(bucketCount);
	const growsUp = direction === 'up';

	// Only the bars present when this layer mounted are part of the entrance.
	// A bar that appears later belongs to data arriving on its own, and must
	// take its place without announcing itself.
	const [fresh, setFresh] = useState(true);

	useEffect(() => {
		const timeout = setTimeout(() => setFresh(false), BAR_ENTRANCE_TOTAL_MS);
		return () => clearTimeout(timeout);
	}, []);

	return (
		<>
			{bars.map(({index, intensity}) => (
				<div
					key={index}
					style={{
						position: 'absolute',
						left: `${index * widthPercent}%`,
						...(growsUp ? {bottom: 0} : {top: 0}),
						width: barWidth,
						height: 3 + intensity * (TRACK_HEIGHT - 3),
						borderRadius: growsUp ? '1px 1px 0 0' : '0 0 1px 1px',
						background: color,
						opacity: 0.35 + intensity * 0.65,
						transformOrigin: growsUp ? 'bottom' : 'top',
						animation:
							animate && fresh
								? barGrowAnimation(index, firstBar, lastBar)
								: undefined,
						pointerEvents: 'none',
					}}
				/>
			))}
		</>
	);
};

// Memoized because the track re-renders on every mouse move while the bars
// themselves change only when the window or the filter does.
export const VolumeBars = memo(VolumeBarsImpl);

// Shared by both scatter series for the same reason. The vertical padding has
// to be added back by hand: absolute positioning ignores the track's own.
export const ScatterDot = ({
	fraction,
	hourFraction,
	size,
	color,
	opacity,
	zIndex,
	title,
	animation,
	interactive = true,
	onMouseEnter,
	onMouseLeave,
	onClick,
}: {
	// x is elapsed time across the window, y is time of day.
	fraction: number;
	hourFraction: number;
	size: number;
	color: string;
	// Capped below 1 by callers so overlapping points blend rather than one
	// hiding another.
	opacity: number;
	zIndex: number;
	title: string;
	animation: string | undefined;
	// False while the series retracts, so a dot on its way out cannot be
	// hovered for a hint or clicked into a diff.
	interactive?: boolean;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
	onClick?: () => void;
}) => (
	<div
		title={title}
		// Without stopping it here, clicking a dot to inspect its diff would also
		// start a scrub-drag on the track underneath.
		onPointerDown={onClick && (event => event.stopPropagation())}
		onClick={
			onClick &&
			(event => {
				event.stopPropagation();
				onClick();
			})
		}
		onMouseEnter={onMouseEnter}
		onMouseLeave={onMouseLeave}
		style={{
			position: 'absolute',
			left: `${fraction * 100}%`,
			top: EVENTS_MODE_VERTICAL_PADDING + hourFraction * EVENTS_SCATTER_HEIGHT,
			width: size,
			height: size,
			borderRadius: '50%',
			background: color,
			opacity,
			zIndex,
			transform: `translate(${-size / 2}px, -50%)`,
			animation,
			pointerEvents: interactive ? 'auto' : 'none',
			cursor: onClick ? 'pointer' : undefined,
		}}
	/>
);

// Lives on the chart wrapper rather than inside either chart, so it runs
// unbroken through both and the gap between them.
export const ScrubberNeedle = ({
	fraction,
	onGrab,
}: {
	fraction: number;
	// A press here is a scrub, not the start of a range drag. The event still
	// bubbles to the track, which owns the pointer capture and the moving.
	onGrab: () => void;
}) => {
	const [hovered, setHovered] = useState(false);

	const grip = {
		onMouseEnter: () => setHovered(true),
		onMouseLeave: () => setHovered(false),
		onPointerDown: onGrab,
	};

	return (
		<>
			{/* A hairline is a 1px drag target. This is the same line's worth of
			    grabbable width, invisible, centred on it. */}
			<div
				{...grip}
				data-testid="scrubber-needle-grip"
				style={{
					position: 'absolute',
					left: `${fraction * 100}%`,
					top: 0,
					bottom: 0,
					width: NEEDLE_GRIP_WIDTH,
					transform: `translateX(${-NEEDLE_GRIP_WIDTH / 2}px)`,
					zIndex: 3,
					pointerEvents: 'auto',
					cursor: 'ew-resize',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: `${fraction * 100}%`,
					top: 0,
					bottom: 0,
					// A hairline, no glow: the needle marks an exact instant, and a
					// soft edge blooms over bars that can be ~2px wide.
					width: 1,
					background: NEEDLE_COLOR,
					zIndex: 3,
					transform: 'translateX(-0.5px)',
					pointerEvents: 'none',
				}}
			/>
			<div
				{...grip}
				style={{
					position: 'absolute',
					left: `${fraction * 100}%`,
					top: hovered ? -9 : -7,
					width: 0,
					height: 0,
					borderLeft: `${hovered ? 6 : 5}px solid transparent`,
					borderRight: `${hovered ? 6 : 5}px solid transparent`,
					borderTop: `${hovered ? 8 : 7}px solid ${NEEDLE_COLOR}`,
					zIndex: 3,
					transform: `translateX(${hovered ? -6 : -5}px)`,
					pointerEvents: 'auto',
					cursor: 'ew-resize',
				}}
			/>
		</>
	);
};

// Hints hang below the charts; floating above covers the scope/mode controls,
// which is the context being read while pointing at something.
export const ScrubberHoverHint = ({
	label,
	rows,
	segmentLabel,
	stripeColor,
	fraction,
	trackWidthPx,
	empty = false,
}: {
	label: string;
	rows: string[];
	// Drawn above the hint's own label, so the hovered moment names its period.
	segmentLabel: string | undefined;
	stripeColor: string;
	// Fraction of the track the hint points at, and the track's measured width.
	fraction: number;
	trackWidthPx: number;
	// An interval containing nothing. Still shown, but a shade down.
	empty?: boolean;
}) => (
	<div
		style={{
			position: 'absolute',
			top: '100%',
			marginTop: 6,
			left: clamp(
				fraction * trackWidthPx - HOVER_HINT_WIDTH / 2,
				0,
				Math.max(0, trackWidthPx - HOVER_HINT_WIDTH),
			),
			width: HOVER_HINT_WIDTH,
			// Border-box so `width` matches what the clamp math assumes; otherwise
			// border and padding push the box past the track's edge.
			boxSizing: 'border-box',
			display: 'flex',
			flexDirection: 'column',
			gap: 2,
			textAlign: 'left',
			background: GUI_THEME.panel,
			border: `1px solid ${GUI_THEME.line}`,
			borderLeft: `3px solid ${empty ? GUI_THEME.dim : stripeColor}`,
			// Smaller than the 6px used elsewhere: a rounder corner clips the 3px
			// stripe into a visible wedge.
			borderRadius: 3,
			padding: '6px 10px',
			pointerEvents: 'none',
			// Above the board content this overhangs.
			zIndex: 5,
		}}
	>
		{segmentLabel && (
			<div style={{fontSize: 10, color: GUI_THEME.dim}}>{segmentLabel}</div>
		)}
		<div
			style={{
				fontSize: 11,
				fontWeight: 600,
				color: empty ? GUI_THEME.secondary : GUI_THEME.primary,
				whiteSpace: 'normal',
				wordBreak: 'break-word',
			}}
		>
			{label}
		</div>
		{rows.map((row, index) => (
			<div
				key={index}
				style={{
					fontSize: 11,
					color: empty ? GUI_THEME.dim : GUI_THEME.secondary,
					whiteSpace: 'normal',
					wordBreak: 'break-word',
				}}
			>
				{row}
			</div>
		))}
	</div>
);

export type ScatterPoint = {
	key: string;
	// Set only on a per-event dot, which is what a log row can be matched to.
	id: string | null;
	// The moment the point stands for, for the hint's own labelling.
	t: number;
	// x across the window, y as time of day — the punchcard's two axes.
	fraction: number;
	hourFraction: number;
	radius: number;
	color: string;
	opacity: number;
	title: string;
	commitSha: string | null;
};

// One series. Each animates on its own, so unticking "Code" retracts the
// commits while the board events stay put.
export type ScatterLayer = {
	id: string;
	points: ScatterPoint[];
	// Changing this replays the entrance for this layer.
	generation: string;
	// On its way out: draw the retraction, then stop drawing it at all.
	leaving: boolean;
};

type Phase = {mode: 'in' | 'out'; startedAt: number};

// How near the pointer has to be, in px, to count as over a dot. Larger than
// the dots themselves: they are 2px radius and would be almost unhittable.
const HIT_RADIUS = 7;

const pointAt = (
	layers: readonly ScatterLayer[],
	x: number,
	y: number,
	width: number,
): ScatterPoint | null => {
	let best: ScatterPoint | null = null;
	let bestDistance = HIT_RADIUS * HIT_RADIUS;

	for (const layer of layers) {
		if (layer.leaving) continue;

		for (const point of layer.points) {
			const dx = point.fraction * width - x;
			const dy =
				EVENTS_MODE_VERTICAL_PADDING +
				point.hourFraction * EVENTS_SCATTER_HEIGHT -
				y;
			const distance = dx * dx + dy * dy;

			if (distance <= bestDistance) {
				bestDistance = distance;
				best = point;
			}
		}
	}

	return best;
};

// One node instead of one per event. At 2.2k dots the DOM version was 93% of
// the whole document, and every frame that touched an ancestor paid for it.
// Drawing them costs the same whether there are ten or ten thousand.
// Everything else fades to this while one event is singled out, so the dot that
// stays at full strength reads as the answer.
const DIMMED_ALPHA = 0.08;
const HIGHLIGHT_RADIUS_SCALE = 2.2;

export const ScatterCanvas = ({
	layers,
	animate,
	highlightId,
	onPointEnter,
	onPointLeave,
	onPressCommit,
}: {
	layers: readonly ScatterLayer[];
	animate: boolean;
	// The one event to single out, or null for the plain chart.
	highlightId: string | null;
	onPointEnter: (point: ScatterPoint) => void;
	onPointLeave: () => void;
	// The commit a press landed on, or null for anywhere else. Reported rather
	// than acted on: the track holds the pointer capture, so it is the one that
	// can tell this press apart from the start of a range drag.
	onPressCommit: (sha: string | null) => void;
}) => {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const sizeRef = useRef({width: 0, height: 0});
	// Read through refs by the draw loop, so a data change never restarts it.
	const layersRef = useRef(layers);
	layersRef.current = layers;
	// Only dims when the highlighted event is actually on the chart. It may not
	// be: an event outside the fetched window has no dot, and the bucketed
	// fallback dots carry no id at all.
	// Memoized: this walks every plotted point, and the track re-renders on
	// every mouse move.
	const activeHighlight = useMemo(
		() =>
			highlightId !== null &&
			layers.some(layer => layer.points.some(point => point.id === highlightId))
				? highlightId
				: null,
		[layers, highlightId],
	);
	const highlightRef = useRef(activeHighlight);
	highlightRef.current = activeHighlight;
	const phasesRef = useRef(new Map<string, Phase>());
	const frameRef = useRef<number | null>(null);
	const hoveredRef = useRef<string | null>(null);
	// The scatter's entrance is drawn, not animated by CSS, so it emits no
	// animationstart for a test to observe. This says the same thing.
	const [entrancePlaying, setEntrancePlaying] = useState(false);

	const paint = useCallback((now: number) => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext('2d');
		if (!canvas || !context) return false;

		const {width, height} = sizeRef.current;
		context.clearRect(0, 0, width, height);

		let running = false;

		for (const layer of layersRef.current) {
			const phase = phasesRef.current.get(layer.id);
			const elapsed = phase ? now - phase.startedAt : null;
			const done = elapsed === null || elapsed >= DOT_EXIT_TOTAL_MS;

			if (phase && !done) running = true;
			// A finished exit leaves nothing behind.
			if (phase?.mode === 'out' && done) continue;

			for (const point of layer.points) {
				const scale =
					phase === null || phase === undefined || done
						? 1
						: phase.mode === 'in'
						? dotEntranceScale(point.key, elapsed!)
						: dotExitScale(point.key, elapsed!);

				if (scale <= 0) continue;

				const highlight = highlightRef.current;
				const isHighlighted = highlight !== null && point.id === highlight;
				const radiusScale =
					scale * (isHighlighted ? HIGHLIGHT_RADIUS_SCALE : 1);
				const cx = point.fraction * width;
				const cy =
					EVENTS_MODE_VERTICAL_PADDING +
					point.hourFraction * EVENTS_SCATTER_HEIGHT;

				context.globalAlpha =
					highlight === null ? point.opacity : isHighlighted ? 1 : DIMMED_ALPHA;
				context.fillStyle = point.color;
				context.beginPath();
				context.arc(cx, cy, point.radius * radiusScale, 0, Math.PI * 2);
				context.fill();

				// A halo as well as a bigger dot: at 2-3px a size change alone is easy
				// to miss on a track holding hundreds of them.
				if (isHighlighted) {
					context.globalAlpha = 0.25;
					context.beginPath();
					context.arc(cx, cy, point.radius * radiusScale * 2.4, 0, Math.PI * 2);
					context.fill();
				}
			}
		}

		context.globalAlpha = 1;

		return running;
	}, []);

	const run = useCallback(() => {
		if (frameRef.current !== null) return;

		const step = () => {
			frameRef.current = null;
			const running = paint(performance.now());

			if (running) frameRef.current = requestAnimationFrame(step);
			else setEntrancePlaying(false);
		};

		frameRef.current = requestAnimationFrame(step);
	}, [paint]);

	// The backing store is sized in device pixels and the context scaled to
	// match, or the dots are blurry on a retina display.
	useEffect(() => {
		const canvas = canvasRef.current;
		const parent = canvas?.parentElement;
		if (!canvas || !parent) return;

		const resize = () => {
			const ratio = window.devicePixelRatio || 1;
			const {width, height} = parent.getBoundingClientRect();

			sizeRef.current = {width, height};
			canvas.width = Math.round(width * ratio);
			canvas.height = Math.round(height * ratio);
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
			paint(performance.now());
		};

		resize();

		const observer = new ResizeObserver(resize);
		observer.observe(parent);

		return () => observer.disconnect();
	}, [paint]);

	// Each layer starts its own entrance or exit. Scrubbing changes neither, so
	// it never animates.
	const signature = layers
		.map(layer => `${layer.id}:${layer.generation}:${layer.leaving}`)
		.join('|');

	useEffect(() => {
		const seen = new Set<string>();

		for (const layer of layers) {
			seen.add(layer.id);
			const key = `${layer.generation}:${layer.leaving}`;
			const marker = `${layer.id}@${key}`;
			const current = phasesRef.current.get(layer.id);

			if (
				(current as (Phase & {marker?: string}) | undefined)?.marker === marker
			)
				continue;

			if (!animate) {
				phasesRef.current.delete(layer.id);
				continue;
			}

			phasesRef.current.set(layer.id, {
				mode: layer.leaving ? 'out' : 'in',
				startedAt: performance.now(),
				marker,
			} as Phase);

			if (!layer.leaving) setEntrancePlaying(true);
		}

		for (const id of [...phasesRef.current.keys()])
			if (!seen.has(id)) phasesRef.current.delete(id);

		if (animate) run();
		else paint(performance.now());
	}, [signature, animate, run, paint]);

	// Repaint when the data or the highlight changes without a new entrance.
	useEffect(() => {
		if (frameRef.current === null) paint(performance.now());
	}, [layers, activeHighlight, paint]);

	useEffect(
		() => () => {
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		},
		[],
	);

	const hitTest = (event: React.MouseEvent<HTMLCanvasElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();

		return pointAt(
			layersRef.current,
			event.clientX - rect.left,
			event.clientY - rect.top,
			rect.width,
		);
	};

	return (
		<canvas
			ref={canvasRef}
			data-testid="scatter-canvas"
			data-entrance={entrancePlaying ? 'playing' : 'done'}
			data-highlight={activeHighlight ?? ''}
			style={{position: 'absolute', inset: 0}}
			onMouseMove={event => {
				const point = hitTest(event);
				if (point?.key === hoveredRef.current) return;

				hoveredRef.current = point?.key ?? null;
				if (point) onPointEnter(point);
				else onPointLeave();
			}}
			onMouseLeave={() => {
				hoveredRef.current = null;
				onPointLeave();
			}}
			// Never stopped, not even over a commit: every press has to reach the
			// track, or a range drag that begins on a dot never begins at all — and
			// on a busy scatter most of them do. What the press turns out to mean is
			// settled on release, by how far it travelled.
			//
			// There is deliberately no onClick here. The track takes pointer
			// capture, which retargets the compatibility mouse events with it, so a
			// click on the canvas is not the canvas's to hear.
			onPointerDown={event => onPressCommit(hitTest(event)?.commitSha ?? null)}
		/>
	);
};
