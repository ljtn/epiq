// The two things on the control row that open: the series picker, which says
// what the chart plots and can narrow each series to particular tags or
// people, and the scope picker, which is the same choice of window the wide
// bar spells out in full. Both are popovers that dismiss on a click away.

import {useEffect, useRef, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {
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
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';

// Named once: the collapsed header puts the same box up when the rest of this
// row is not on screen.
export const SCOPE_ONLY_LABEL = 'Scope only';
export const TICKET_ONLY_LABEL = 'Ticket only';

// What every control wears while the socket is down.
export const mutedStyle: React.CSSProperties = {
	opacity: 0.4,
	cursor: 'not-allowed',
};

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
export const BoardSeriesGroup = ({
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

export const ScopeSelect = ({
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
