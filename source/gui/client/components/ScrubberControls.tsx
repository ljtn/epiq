// The row of controls above the chart: what the window covers, which series
// are drawn, where the needle steps to next, and the button that plays the
// whole thing back. Presentational — props in, JSX out; the state behind
// them is TimeScrubber's.

import {useEffect, useRef, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {
	formatPeriodLabel,
	isPeriodWindow,
	LayoutMode,
	PeriodRange,
	Scope,
	scopeButtonLabel,
	SCOPES,
	BOARD_VIEWS,
	boardViewColor,
	soleVisibleIdentity,
	identityAxisFor,
	BoardView,
	EventCategory,
} from '../lib/scrubber';
import {GuiEventIdentity} from '../lib/gui-state.model';
import {Checkbox} from './Checkbox';
import {IconBars} from './IconBars';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronLeft} from './IconChevronLeft';
import {IconChevronRight} from './IconChevronRight';
import {IconLog} from './IconLog';
import {IconTimeline} from './IconTimeline';
import {IconPlay} from './IconPlayback';
import {IconScatter} from './IconScatter';

// Named once: the collapsed header puts the same box up when the rest of this
// row is not on screen.
export const SCOPE_ONLY_LABEL = 'Scope only';
export const TICKET_ONLY_LABEL = 'Ticket only';

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

// "Board events" rather than "All": as the collapsed trigger it is the only
// thing naming the series, and a bare "All" two controls from "All boards" says
// nothing about which is which.
const VIEW_LABELS: Record<BoardView, string> = {
	all: 'Board events',
	...CATEGORY_LABELS,
};

// Fixed, not sized to its label: the selection changes as the thing is used,
// and a trigger that grew with it would shove the scope buttons beside it out
// from under the pointer. Wide enough for the labels themselves; a name long
// enough to overflow is clipped, and the open list spells it out in full.
const SELECT_TRIGGER_WIDTH = 148;

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
	minWidth: 178,
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
	square,
	onSelect,
}: {
	label: string;
	selected: boolean;
	color: string;
	disabled?: boolean;
	// The row that stands for the whole series rather than one kind of it. Drawn
	// square, like the series checkbox on the bar, so it reads as the parent of
	// the kinds indented under it — which is what the word "All" used to do.
	square?: boolean;
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
				borderRadius: square ? 2 : '50%',
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
						borderRadius: square ? 1 : '50%',
						background: color,
					}}
				/>
			)}
		</span>
		{label}
	</button>
);

// A checkbox for the series and a select for what it draws, one kind at a time.
// That is what lets a colour mean one thing: "Board events" colours by kind,
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

						// The whole series heads the list; the kinds of it are indented
						// under that, which is the hierarchy the word "All" used to say
						// out loud.
						const isWholeSeries = option === 'all';

						return (
							<div
								key={option}
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: 7,
									paddingLeft: isWholeSeries ? 0 : 14,
								}}
							>
								<div style={{display: 'flex', alignItems: 'center', gap: 3}}>
									<Radio
										label={VIEW_LABELS[option]}
										selected={selected}
										color={boardViewColor(option)}
										disabled={!showIssues || !filtered}
										square={isWholeSeries}
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

// The scope row's narrow form: one trigger naming the scope in hand, over the
// same popover the board series uses, rather than seven buttons that do not fit.
//
// Its own component because it holds the open/shut state, and ScrubberControls
// is a plain expression with nowhere to put a hook.
// The narrow form's width, shared by the trigger and the menu under it so the
// two line up.
const SCOPE_SELECT_WIDTH = 108;

const ScopeSelect = ({
	scope,
	zoomed,
	connected,
	onChangeScope,
}: {
	scope: Scope;
	zoomed: boolean;
	connected: boolean;
	onChangeScope: (scope: Scope) => void;
}) => {
	const [open, setOpen] = useState(false);

	// The dismissal the board series menu already uses: a select closes when you
	// look away from it, and this popover sits over the chart, so one left open
	// takes the timeline's pointer with it.
	const ref = useDismissOnOutsideClick(open, () => setOpen(false));

	// A dropped socket disables the trigger, and a menu nobody can act on must
	// not be left sitting there.
	useEffect(() => {
		if (!connected) setOpen(false);
	}, [connected]);

	return (
		<div ref={ref} style={{position: 'relative'}}>
			<button
				type="button"
				data-testid="scope-select"
				onClick={() => setOpen(!open)}
				disabled={!connected}
				aria-haspopup="listbox"
				aria-expanded={open}
				title="Choose the window the timeline covers"
				style={{
					...selectTriggerStyle(GUI_THEME.primary, !connected),
					width: SCOPE_SELECT_WIDTH,
				}}
			>
				{/* A dragged-out window is none of the periods on offer, so it names
				    itself here the way it reads as pressed on the wide row. */}
				<span>{zoomed ? 'Zoom' : scopeButtonLabel(scope)}</span>
				<span style={{display: 'inline-flex', flexShrink: 0}}>
					<IconChevronDown size={12} />
				</span>
			</button>

			{open && (
				// Narrower than the shared popover's default, which is sized for the
				// series menu's identity lists: a column of period names needs no
				// more than the trigger it drops from.
				<div
					role="listbox"
					style={{...popoverStyle, minWidth: SCOPE_SELECT_WIDTH}}
				>
					{SCOPES.map(option => (
						<button
							key={option}
							type="button"
							role="option"
							aria-selected={!zoomed && scope === option}
							onClick={() => {
								onChangeScope(option);
								setOpen(false);
							}}
							style={{
								background: 'transparent',
								border: 'none',
								padding: 0,
								textAlign: 'left',
								fontFamily: 'inherit',
								fontSize: 10,
								cursor: 'pointer',
								color:
									!zoomed && scope === option
										? GUI_THEME.accent
										: GUI_THEME.secondary,
							}}
						>
							{scopeButtonLabel(option)}
						</button>
					))}
				</div>
			)}
		</div>
	);
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
	canPlay: boolean;
	playTitle: string;
	onPlay: () => void;
	// The row has no space for the scope buttons, so they fold into a select.
	narrow: boolean;
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
									? 'The ticket\u2019s own stretch — untick "Ticket only" to page'
									: 'Earlier'
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
									? 'Held behind the ticket’s own stretch — untick "Ticket only" to come back to it'
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
				)}
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
							? 'The board is already down to one ticket — untick "Ticket only" to narrow by window instead'
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
				title={
					isScrubbing ? 'Leave history and follow the board again' : undefined
				}
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
