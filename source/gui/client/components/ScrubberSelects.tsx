// The two things on the control row that open: the series picker, which says
// what the chart plots and can narrow each series to particular tags or
// people, and the scope picker, which is the same choice of window the wide
// bar spells out in full. Both are popovers that dismiss on a click away.

import {useEffect, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {
	popoverStyle,
	selectLabelStyle,
	selectTriggerStyle,
} from '../lib/select-style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {
	Scope,
	scopeButtonLabel,
	SCOPES,
	boardViewColor,
	soleVisibleIdentity,
	identityAxisFor,
	BoardView,
	EventCategory,
	FILTER_AXES,
	FilterAxis,
} from '../lib/scrubber';
import {AxisState} from '../lib/board-selection';
import {GuiEventIdentity} from '../lib/gui-state.model';
import {Checkbox} from './Checkbox';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';

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

// "Board" rather than "All": as the collapsed trigger it is the only thing
// naming the series, and a bare "All" two controls from "All boards" says
// nothing about which is which. The commit series' trigger beside it names
// what it is measuring — "Commits" or "Lines" — the same way.
const VIEW_LABELS: Record<BoardView, string> = {
	all: 'Board',
	...CATEGORY_LABELS,
	contributors: 'Contributors',
};

// The row an axis is drawn as. Kept here rather than imported so the labels and
// the rows they sit on are read off one table.
const VIEW_FOR_AXIS: Record<FilterAxis, BoardView> = {
	commenter: 'comments',
	tag: 'tagging',
	assignee: 'assigning',
	actor: 'contributors',
};

// What ticking a row asks of every ticket, said in full where the label cannot.
const AXIS_TITLES: Record<FilterAxis, string> = {
	commenter: 'Only tickets with comments',
	tag: 'Only tagged tickets',
	assignee: 'Only assigned tickets',
	actor: 'Only tickets touched in this window',
};

// Fixed, not sized to its label: the selection changes as the thing is used,
// and a trigger that grew with it would shove the scope buttons beside it out
// from under the pointer. Wide enough for the labels themselves — the longest
// being "Contributors (all)" at 18 monospace characters, plus the padding, the
// chevron and some slack. A tag or a person's name long enough to overflow
// past that is clipped, and the open list spells it out in full.
const SELECT_TRIGGER_WIDTH = 162;

const nestedListStyle: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: 7,
	marginLeft: 5,
	paddingLeft: 8,
	borderLeft: `1px solid ${GUI_THEME.line}`,
};

const onlyButtonStyle: React.CSSProperties = {
	background: 'transparent',
	border: `1px solid ${GUI_THEME.line}`,
	borderRadius: 4,
	color: GUI_THEME.dim,
	fontFamily: 'inherit',
	fontSize: 10,
	lineHeight: 1,
	padding: '2px 4px',
	cursor: 'pointer',
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
			fontSize: 11,
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

// Module scope, so a view that colours by nothing hands the same empty legend
// down every render rather than a fresh one to re-memoize against.
const EMPTY_IDENTITIES: GuiEventIdentity[] = [];
const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>();

// A checkbox for the series and a select for what it draws, one kind at a time.
// That is what lets a colour mean one thing: "Board" colours by kind,
// and any single kind colours by the tag or person behind each event, never both
// at once. The trigger reads back whatever is selected, down to the one tag or
// person left when the rest are unticked — the same name and colour the bars and
// dots are then drawn in.
//
// Narrowing is the other half, and it is not tied to that choice: every row
// with a list can be ticked down, several at once, and the board below shows
// the tickets that pass all of them. Only the plotted row's list changes the
// picture; the rest narrow what is underneath it.
export const BoardSeriesGroup = ({
	connected,
	showIssues,
	view,
	identitiesByAxis,
	hiddenIdsByAxis,
	axisStates,
	narrowed,
	expanded,
	expandedAxis,
	filtered,
	onChangeShowIssues,
	onToggleAxis,
	onToggleIdentity,
	onOnlyIdentity,
	onToggleExpanded,
	onSetExpandedAxis,
}: {
	connected: boolean;
	showIssues: boolean;
	view: BoardView;
	// What the current window actually holds, per axis, so each list is a legend
	// for what is on screen rather than a catalogue of the whole repo.
	identitiesByAxis: Record<FilterAxis, GuiEventIdentity[]>;
	hiddenIdsByAxis: Record<FilterAxis, ReadonlySet<string>>;
	// What each row says: off, on with everything under it, or the dash for on
	// with some of it.
	axisStates: Record<FilterAxis, AxisState>;
	narrowed: boolean;
	expanded: boolean;
	expandedAxis: FilterAxis | null;
	filtered: boolean;
	onChangeShowIssues: (next: boolean) => void;
	onToggleAxis: (axis: FilterAxis, on: boolean) => void;
	onToggleIdentity: (axis: FilterAxis, id: string, next: boolean) => void;
	onOnlyIdentity: (axis: FilterAxis, id: string) => void;
	onToggleExpanded: () => void;
	onSetExpandedAxis: (axis: FilterAxis | null) => void;
}) => {
	const viewAxis = identityAxisFor(view);
	const identities =
		viewAxis === null ? EMPTY_IDENTITIES : identitiesByAxis[viewAxis];
	const hiddenIds =
		viewAxis === null ? EMPTY_HIDDEN : hiddenIdsByAxis[viewAxis];

	// Down to one tag or person, that identity *is* the series, so it gives the
	// trigger its name and its colour. Several hidden and no single colour would
	// be honest, so the trigger only says that it is narrowed.
	const sole = soleVisibleIdentity(identities, hiddenIds);
	const partial = filtered && hiddenIds.size > 0 && viewAxis !== null;
	// Narrowed somewhere the plotted series does not show: the picture is intact
	// and the board under it is not, which the trigger has to say or nothing on
	// this row accounts for the missing tickets.
	const elsewhere = filtered && narrowed && !partial && sole === null;

	// The series, then what of it, in every state — `(all)` included, so the
	// unnarrowed trigger says so rather than leaving it to be inferred from the
	// absence of a note. The commit select beside it reads the same way.
	const label = sole
		? `${VIEW_LABELS[view]}: ${sole.name}`
		: partial
		? `${VIEW_LABELS[view]} (multi)`
		: elsewhere
		? `${VIEW_LABELS[view]} (filtered)`
		: `${VIEW_LABELS[view]} (all)`;

	const color =
		sole?.color ??
		(partial || elsewhere ? GUI_THEME.dim2 : boardViewColor(view));

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
					testId="show-board-events"
					title="Show board events"
					checked={showIssues}
					activeColor={color}
					disabled={!connected}
					onChange={onChangeShowIssues}
				/>
				{/* A handle of its own: its label carries the series *and* what of it
				    is plotted, so the text is not a name anything can be found by. */}
				<button
					type="button"
					data-testid="series-select"
					onClick={onToggleExpanded}
					disabled={!showIssues || !connected}
					title={
						filtered
							? 'Choose what to plot'
							: 'Too many events to split by kind'
					}
					aria-haspopup="listbox"
					aria-expanded={expanded}
					style={{
						...selectTriggerStyle(color, !showIssues),
						width: SELECT_TRIGGER_WIDTH,
						...(connected ? {} : mutedStyle),
					}}
				>
					{/* No title of its own — the button's explains more. */}
					<span style={selectLabelStyle}>{label}</span>
					<span style={{display: 'inline-flex', flexShrink: 0}}>
						<IconChevronDown size={12} />
					</span>
				</button>
			</div>

			{expanded && (
				<div role="group" aria-label="Filter the board" style={popoverStyle}>
					{FILTER_AXES.map(axis => {
						const option = VIEW_FOR_AXIS[axis];
						const state = axisStates[axis];
						const open = expandedAxis === axis;
						const rowLabel = VIEW_LABELS[option].toLowerCase();

						return (
							<div
								key={axis}
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: 7,
								}}
							>
								<div style={{display: 'flex', alignItems: 'center', gap: 3}}>
									<Checkbox
										label={VIEW_LABELS[option]}
										checked={state === 'all'}
										mixed={state === 'some'}
										activeColor={boardViewColor(option)}
										disabled={!showIssues || !filtered}
										title={AXIS_TITLES[axis]}
										onChange={next => onToggleAxis(axis, next)}
									/>
									<button
										type="button"
										// Named, because its title is not a handle: TooltipLayer
										// takes that away while its own tooltip is open.
										data-testid={`filter-axis-${axis}`}
										disabled={!showIssues || !filtered}
										// Opening a list does not switch its axis on: reading what
										// is under a row is not the same as filtering by it.
										onClick={() => onSetExpandedAxis(open ? null : axis)}
										// Named after its own row: four rows carry one of these,
										// and "Pick which to show" on all four says nothing about
										// which list is being opened.
										title={open ? `Hide ${rowLabel}` : `Pick ${rowLabel}`}
										aria-expanded={open}
										style={{
											...disclosureStyle,
											// In the row's own colour rather than the accent, so a
											// lit caret reads as belonging to the thing it is
											// holding back.
											color:
												state === 'some'
													? boardViewColor(option)
													: disclosureStyle.color,
										}}
									>
										{open ? (
											<IconChevronDown size={12} />
										) : (
											<IconChevronRight size={12} />
										)}
									</button>
								</div>

								{open && identitiesByAxis[axis].length > 0 && (
									<div
										// Named, so what is under a row is tellable from the rows
										// themselves — every one of these is a checkbox too.
										role="group"
										aria-label={`Which ${rowLabel} to show`}
										style={{
											...nestedListStyle,
											// A repo with dozens of tags would otherwise push the
											// board itself off the screen.
											maxHeight: 132,
											overflowY: 'auto',
										}}
									>
										{identitiesByAxis[axis].map(identity => (
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
													checked={!hiddenIdsByAxis[axis].has(identity.id)}
													activeColor={identity.color}
													disabled={!showIssues}
													onChange={next =>
														onToggleIdentity(axis, identity.id, next)
													}
												/>
												<button
													type="button"
													title={`Show only ${identity.name}`}
													disabled={!showIssues}
													onClick={() => onOnlyIdentity(axis, identity.id)}
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

// The Code series' select, the shape of the board series' beside it: a box
// for whether commits are drawn at all, and a trigger naming which — every
// commit in the repository, or only the ones linked to a ticket. The trigger
// names the series and then which, the way `Board (filtered)` does two controls
// along — `Linked` on its own named the narrowing and left the series unsaid.
// Wide enough for the longest of the four whole, and fixed there, so switching
// between them does not resize the row under the pointer. `Commits (linked)` is
// the longest: 16 characters of the app's own monospace face, which the trigger
// inherits — measured at 106px, with the padding and chevron taking 35 more. A
// box sized to the pixel is what the rounding then ellipsises, so this carries
// slack on purpose.
const COMMIT_SELECT_WIDTH = 150;

export const CommitSeriesGroup = ({
	connected,
	// The layout draws no commits, so the series is not on offer there. The
	// box keeps its value: the log still reads it.
	idle,
	showCommits,
	linkedOnly,
	linesMeasure,
	onChangeShowCommits,
	onChangeLinkedOnly,
	onChangeLinesMeasure,
}: {
	connected: boolean;
	idle: boolean;
	showCommits: boolean;
	linkedOnly: boolean;
	// What a bar measures, as against which commits it counts. Two questions,
	// so two groups in the list rather than one row of four options: flattened,
	// "the deletions among linked commits" could not be asked for.
	linesMeasure: boolean;
	onChangeShowCommits: (next: boolean) => void;
	onChangeLinkedOnly: (next: boolean) => void;
	onChangeLinesMeasure: (next: boolean) => void;
}) => {
	const [open, setOpen] = useState(false);
	const ref = useDismissOnOutsideClick(open, () => setOpen(false));
	const usable = connected && !idle;

	useEffect(() => {
		if (!usable) setOpen(false);
	}, [usable]);

	const choose = (next: boolean) => {
		onChangeLinkedOnly(next);
		setOpen(false);
	};

	// Both groups close the list behind them: either row is one choice made,
	// and a list left standing over the chart is the thing the scope select
	// already takes care to avoid.
	const measure = (next: boolean) => {
		onChangeLinesMeasure(next);
		setOpen(false);
	};

	return (
		<div ref={ref} style={{position: 'relative'}}>
			<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
				{/* Unlabelled, as the board series' box is: the select beside it
				    names the series. */}
				<Checkbox
					label={null}
					testId="show-commits"
					title={idle ? 'Flow draws tickets only' : 'Show commits'}
					checked={showCommits}
					activeColor={GUI_THEME.green}
					disabled={!usable}
					onChange={onChangeShowCommits}
				/>
				<button
					type="button"
					data-testid="commit-select"
					onClick={() => setOpen(!open)}
					disabled={!showCommits || !usable}
					aria-haspopup="listbox"
					aria-expanded={open}
					title={
						idle ? 'Flow draws tickets only' : 'Choose which commits to plot'
					}
					style={{
						...selectTriggerStyle(GUI_THEME.green, !showCommits || idle),
						width: COMMIT_SELECT_WIDTH,
						...(usable ? {} : mutedStyle),
					}}
				>
					<span style={selectLabelStyle}>
						{`${linesMeasure ? 'Lines' : 'Commits'} (${
							linkedOnly ? 'linked' : 'all'
						})`}
					</span>
					<span style={{display: 'inline-flex', flexShrink: 0}}>
						<IconChevronDown size={12} />
					</span>
				</button>
			</div>

			{open && (
				// Two groups, each with its own label, because the list asks two
				// questions and a reader who cannot see the divider has only the
				// grouping to tell them apart — one `radiogroup` holding four rows
				// with two of them checked says nothing true about either.
				<div style={{...popoverStyle, minWidth: 160}}>
					<div
						role="radiogroup"
						aria-label="Which commits to plot"
						style={{display: 'contents'}}
					>
						<Radio
							label="All"
							selected={!linkedOnly}
							color={GUI_THEME.green}
							onSelect={() => choose(false)}
						/>
						{/* Named without the noun, because the group below supplies it:
					    with `Lines` chosen, a row reading "All commits" over one
					    reading "Lines" contradicts itself. What is linked is the
					    commit — to a ticket the client knows, on any board for the
					    chart and on this one for the log, and while the board is
					    narrowed to some tickets, only to those. */}
						<Radio
							label="Linked"
							selected={linkedOnly}
							color={GUI_THEME.green}
							onSelect={() => choose(true)}
						/>
					</div>

					{/* The second question, kept apart from the first: which commits
					    are drawn is one choice, what their bars measure is another,
					    and either can be made without disturbing the other. */}
					<div
						aria-hidden
						style={{height: 1, background: GUI_THEME.line, margin: '3px 0'}}
					/>

					<div
						role="radiogroup"
						aria-label="What the bars measure"
						style={{display: 'contents'}}
					>
						<Radio
							label="Commit count"
							selected={!linesMeasure}
							color={GUI_THEME.green}
							onSelect={() => measure(false)}
						/>
						<Radio
							label="Lines (+/-)"
							selected={linesMeasure}
							color={GUI_THEME.green}
							onSelect={() => measure(true)}
						/>
					</div>
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
				title="Choose the window"
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
								fontSize: 11,
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
