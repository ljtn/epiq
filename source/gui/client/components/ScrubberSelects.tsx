// The row's popovers: the series picker (what the chart plots, narrowed by tag
// or person) and the scope picker.

import {GUI_THEME} from '../lib/gui-theme';
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
import {ICON_SIZE, IconButton} from './IconButton';
import {Menu, MenuItem, MenuSection} from './Menu';
import {useRepoLabel} from '../lib/use-repo-label';
import {showsRepoToggles} from '../lib/commit-repo-filter';

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

// "Board", not "All", which would read like "All boards" beside it.
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

// Fixed, so a changing selection doesn't shove the scope buttons; fits
// "Contributors (all)". Longer names clip.
const SELECT_TRIGGER_WIDTH = 162;

const nestedListStyle: React.CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: 2,
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
			gap: 8,
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

// The series checkbox and a select for what it draws, one kind at a time so a
// colour means one thing. Every list can also narrow the board below.
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

	// Down to one tag or person, it names and colours the trigger.
	const sole = soleVisibleIdentity(identities, hiddenIds);
	const partial = filtered && hiddenIds.size > 0 && viewAxis !== null;
	// Narrowed by a series not plotted: the trigger must account for missing tickets.
	const elsewhere = filtered && narrowed && !partial && sole === null;

	// The series then its narrowing, `(all)` included.
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

	// A server-capped window is pre-summed across kinds; greyed options say why.
	return (
		<Menu
			open={expanded}
			onOpenChange={next => next !== expanded && onToggleExpanded()}
			// A handle of its own: its label carries the series *and* what of it
			// is plotted, so the text is not a name anything can be found by.
			testId="series-select"
			label={label}
			color={color}
			width={SELECT_TRIGGER_WIDTH}
			minWidth={178}
			disabled={!showIssues || !connected}
			title={filtered ? undefined : 'Too many events to split by kind'}
			popupRole="group"
			popupLabel="Filter the board"
			leading={
				// Unlabelled: the select beside it already names the series.
				<Checkbox
					label={null}
					testId="show-board-events"
					title="Show board events"
					checked={showIssues}
					activeColor={color}
					disabled={!connected}
					onChange={onChangeShowIssues}
				/>
			}
		>
			{() =>
				FILTER_AXES.map(axis => {
					const option = VIEW_FOR_AXIS[axis];
					const state = axisStates[axis];
					const open = expandedAxis === axis;
					const rowLabel = VIEW_LABELS[option].toLowerCase();

					return (
						<div
							key={axis}
							style={{display: 'flex', flexDirection: 'column', gap: 2}}
						>
							{/* Pulled in on the right, so the chevron's square sits in the
							    row's height rather than adding to it. */}
							<MenuItem style={{padding: '1px 2px 1px 8px'}}>
								<Checkbox
									label={VIEW_LABELS[option]}
									checked={state === 'all'}
									mixed={state === 'some'}
									activeColor={boardViewColor(option)}
									disabled={!showIssues || !filtered}
									title={AXIS_TITLES[axis]}
									onChange={next => onToggleAxis(axis, next)}
								/>
								<IconButton
									// Named, because its title is not a handle: TooltipLayer
									// takes that away while its own tooltip is open.
									testId={`filter-axis-${axis}`}
									disabled={!showIssues || !filtered}
									// Opening a list does not switch its axis on: reading what
									// is under a row is not the same as filtering by it.
									onClick={() => onSetExpandedAxis(open ? null : axis)}
									title={open ? `Hide ${rowLabel}` : `Pick ${rowLabel}`}
									aria-expanded={open}
								>
									{open ? (
										<IconChevronDown size={ICON_SIZE} />
									) : (
										<IconChevronRight size={ICON_SIZE} />
									)}
								</IconButton>
							</MenuItem>

							{open && identitiesByAxis[axis].length > 0 && (
								<div
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
										<MenuItem key={identity.id}>
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
												aria-label={`Show only ${identity.name}`}
												disabled={!showIssues}
												onClick={() => onOnlyIdentity(axis, identity.id)}
												style={onlyButtonStyle}
											>
												Only
											</button>
										</MenuItem>
									))}
								</div>
							)}
						</div>
					);
				})
			}
		</Menu>
	);
};

// The Code series' select: whether commits are drawn, and which. Fixed width,
// fitting `Commits (linked)` with slack against ellipsis.
const COMMIT_SELECT_WIDTH = 150;

export const CommitSeriesGroup = ({
	connected,
	// The layout draws no commits, so the series is not on offer there. The
	// box keeps its value: the log still reads it.
	idle,
	showCommits,
	linkedOnly,
	linesMeasure,
	repos,
	hiddenRepos,
	onChangeShowCommits,
	onChangeLinkedOnly,
	onChangeLinesMeasure,
	onToggleRepo,
}: {
	connected: boolean;
	idle: boolean;
	showCommits: boolean;
	linkedOnly: boolean;
	// The repos the window's commits come from, by key — the board's own is
	// the empty one. Only offered when there is more than one to choose from.
	repos: readonly string[];
	hiddenRepos: ReadonlySet<string>;
	onToggleRepo: (repo: string) => void;
	// What a bar measures, separate from which commits it counts.
	linesMeasure: boolean;
	onChangeShowCommits: (next: boolean) => void;
	onChangeLinkedOnly: (next: boolean) => void;
	onChangeLinesMeasure: (next: boolean) => void;
}) => {
	const labelOf = useRepoLabel();
	const usable = connected && !idle;

	return (
		<Menu
			testId="commit-select"
			label={`${linesMeasure ? 'Lines' : 'Commits'} (${
				linkedOnly ? 'linked' : 'all'
			})`}
			color={GUI_THEME.green}
			width={COMMIT_SELECT_WIDTH}
			minWidth={160}
			disabled={!showCommits || !usable}
			title={idle ? 'Flow draws tickets only' : undefined}
			popupRole="group"
			leading={
				// Unlabelled, as the board series' box is.
				<Checkbox
					label={null}
					testId="show-commits"
					title={idle ? 'Flow draws tickets only' : 'Show commits'}
					checked={showCommits}
					activeColor={GUI_THEME.green}
					disabled={!usable}
					onChange={onChangeShowCommits}
				/>
			}
		>
			{close => {
				// Either group closes the list: each row is one choice made.
				const choose = (next: boolean) => {
					onChangeLinkedOnly(next);
					close();
				};
				const measure = (next: boolean) => {
					onChangeLinesMeasure(next);
					close();
				};

				return (
					<>
						{/* Each group under its question: the list asks three. */}
						<MenuSection label="Commits" />
						<div
							role="radiogroup"
							aria-label="Which commits to plot"
							style={{display: 'contents'}}
						>
							<MenuItem>
								<Radio
									label="All"
									selected={!linkedOnly}
									color={GUI_THEME.green}
									onSelect={() => choose(false)}
								/>
							</MenuItem>
							{/* Without the noun, which the group below supplies. */}
							<MenuItem>
								<Radio
									label="Linked"
									selected={linkedOnly}
									color={GUI_THEME.green}
									onSelect={() => choose(true)}
								/>
							</MenuItem>
						</div>

						<MenuSection label="Bars" />
						<div
							role="radiogroup"
							aria-label="What the bars measure"
							style={{display: 'contents'}}
						>
							<MenuItem>
								<Radio
									label="Commit count"
									selected={!linesMeasure}
									color={GUI_THEME.green}
									onSelect={() => measure(false)}
								/>
							</MenuItem>
							<MenuItem>
								<Radio
									label="Lines (+/-)"
									selected={linesMeasure}
									color={GUI_THEME.green}
									onSelect={() => measure(true)}
								/>
							</MenuItem>
						</div>

						{showsRepoToggles(repos) && (
							<>
								<MenuSection label="Repos" />
								{/* Several can be on at once, so this group stays open
								    while it is changed. */}
								<div
									role="group"
									aria-label="Which repos to plot"
									style={{display: 'contents'}}
								>
									{repos.map(repo => (
										<MenuItem key={repo || 'own'}>
											<Checkbox
												label={repo ? labelOf(repo) : 'This repo'}
												testId="commit-repo-toggle"
												checked={!hiddenRepos.has(repo)}
												activeColor={GUI_THEME.green}
												onChange={() => onToggleRepo(repo)}
											/>
										</MenuItem>
									))}
								</div>
							</>
						)}
					</>
				);
			}}
		</Menu>
	);
};

// The scope row's narrow form, one popover trigger; this width is shared by
// trigger and menu.
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
}) => (
	// A dragged-out window is none of the periods on offer, so it names itself
	// here the way it reads as pressed on the wide row.
	<Menu
		testId="scope-select"
		label={zoomed ? 'Zoom' : scopeButtonLabel(scope)}
		color={GUI_THEME.primary}
		width={SCOPE_SELECT_WIDTH}
		disabled={!connected}
	>
		{close =>
			SCOPES.map(option => (
				<MenuItem
					key={option}
					role="option"
					selected={!zoomed && scope === option}
					onSelect={() => {
						onChangeScope(option);
						close();
					}}
				>
					{scopeButtonLabel(option)}
				</MenuItem>
			))
		}
	</Menu>
);
