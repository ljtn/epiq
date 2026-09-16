// The board's event log: a panel down the left holding one timestamped line
// per event, grouped by day. The newest day is open and the rest are folded to
// a divider each, so a long history is a handful of rows until a reader asks
// for more of it. The pane scrolls back through what is loaded and stays pinned
// to the bottom as new lines land — but only while it is already there, so
// reading back is not yanked away by the next event.
//
// A panel rather than a wash over the board — it takes its own width and the
// board moves over for it, so neither has to be read through the other.
//
// The rows it is handed are a slice taken against the moment the board is
// standing at, never a list grown as events arrive, so the panel costs the same
// on a year of history as on an hour.

import {
	memo,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {formatTimeOfDay} from '../../../lib/utils/date.utils.js';
import {
	crawlShiftFrames,
	CRAWL_TIMING,
	DEFAULT_OPEN_DAYS,
	daysToOpen,
	EVENT_LOG_STYLES,
	groupByDay,
	isDayOpen,
	LogEntry,
	actorColumnChars,
	actorColumnWidth,
	LOG_ACTOR_CLASS,
	LOG_ACTOR_WIDTH_PROPERTY,
	LOG_DIFF_CLASS,
	LOG_ARROW_CLASS,
	LOG_LANES_CLASS,
	LOG_LANE_ALL_CLASS,
	LOG_LANE_COUNT_PROPERTY,
	LOG_LANE_HEAD_CLASS,
	LOG_LANE_PROPERTY,
	LOG_SPLIT_CLASS,
	LOG_DOT_COLOR_PROPERTY,
	LOG_PANE_PADDING_X,
	LOG_ROW_HEIGHT,
	touchedLines,
} from '../lib/event-log';
import {
	LogField,
	LogFields,
	LOG_FIELD_NAMES,
	LOG_FIELD_ORDER,
	logPaneClassName,
	useLogFields,
} from '../lib/log-fields';
import {
	laneCapacity,
	laneIndexByName,
	laneIndexOf,
	LogLane,
	logLanes,
	useLogSplit,
} from '../lib/log-lanes';
import {Checkbox} from './Checkbox';
import {IconColumns} from './IconColumns';
import {DiffStat} from './DiffStat';
import {
	LogDestination,
	linkedRowFrom,
	readDestination,
	rowAttributes,
} from '../lib/log-destination';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {usePrefersReducedMotion} from '../lib/scrubber';
import {useResizableWidth} from '../lib/use-resizable-width';
import {ResizeHandle} from './ResizeHandle';
import {IconArrowUpRight} from './IconArrowUpRight';
import {IconButton, ICON_SIZE} from './IconButton';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';
import {IconLog} from './IconLog';
import {IconPopOut} from './IconPopOut';

const LOG_WIDTH = 440;
// Narrow enough to still fit a line's time and a few words of it; wide
// enough at the top to read a whole subject, short of taking the board.
const MIN_LOG_WIDTH = 280;
const MAX_LOG_WIDTH = 1000;
const MAX_LOG_RATIO = 0.6;
const LOG_WIDTH_STORAGE_KEY = 'epiq.eventLog.width';
const LOG_HEADER_HEIGHT = 28;

// How near the foot counts as being at it. A couple of rows, so a pin survives
// a sub-pixel scroll position or a rounding difference between scrollHeight and
// the box it is measured against.
const PINNED_SLACK_PX = LOG_ROW_HEIGHT * 2;

const dividerRuleStyle: React.CSSProperties = {
	flex: 1,
	height: 1,
	alignSelf: 'center',
	background: GUI_THEME.line,
};

const DayDivider = ({
	label,
	count,
	open,
	onToggle,
}: {
	label: string;
	count: number;
	open: boolean;
	onToggle: () => void;
}) => (
	<button
		type="button"
		data-testid="log-day"
		aria-expanded={open}
		onClick={onToggle}
		title={open ? `Fold ${label}` : `Show the ${count} lines of ${label}`}
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 8,
			width: '100%',
			height: LOG_ROW_HEIGHT,
			padding: 0,
			background: 'transparent',
			border: 'none',
			color: GUI_THEME.dim,
			fontFamily: 'inherit',
			fontSize: TEXT.meta,
			cursor: 'pointer',
		}}
	>
		<span
			aria-hidden
			style={{display: 'inline-flex', alignItems: 'center', flexShrink: 0}}
		>
			{open ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
		</span>
		<span style={{flexShrink: 0}}>{label}</span>
		{/* The rule between the day and its tally, not after both: run together
		    they read as one number on the end of the date. */}
		<span aria-hidden style={dividerRuleStyle} />
		<span
			style={{
				flexShrink: 0,
				color: GUI_THEME.dim2,
				fontVariantNumeric: 'tabular-nums',
			}}
		>
			{count}
		</span>
	</button>
);

// One element, a span for who did it, and one text node. The clock and the
// kind dot are pseudo-elements of this row rather than spans in it — see
// EVENT_LOG_STYLES — because the panel holds hundreds of these and three spans
// apiece is three hundred nodes of nothing.
//
// The clock, the dot and the name are shown or hidden by the pane's class;
// the label is the one field with no element of its own to hide, so it is the
// one the row is told about.
const EventRow = ({
	entry,
	showLabel,
	lane,
}: {
	entry: LogEntry;
	showLabel: boolean;
	// Which lane the row sits in while the log is split: a number, null on a
	// line nobody signed — it spans them all — and undefined while the log is
	// not split, which leaves the row exactly as it was.
	lane?: number | null;
}) => (
	<div
		data-testid="log-line"
		className={
			lane === null ? `epiq-log-line ${LOG_LANE_ALL_CLASS}` : 'epiq-log-line'
		}
		data-time={formatTimeOfDay(new Date(entry.t))}
		// A row is one clipped line, so a long label is cut off with nowhere to
		// read the rest. Only the browser knows which rows are actually clipped,
		// but a title costs nothing until it is hovered, where measuring every row
		// on every render would not.
		title={entry.label}
		// The event, for the chart to single out while the row is hovered.
		data-event-id={entry.id}
		// Absent on a line that leads nowhere, which is what leaves it inert.
		{...rowAttributes(entry)}
		style={
			{
				[LOG_DOT_COLOR_PROPERTY]: entry.color,
				[LOG_LANE_PROPERTY]: lane ?? 0,
			} as React.CSSProperties
		}
	>
		{entry.actor && (
			<span className={LOG_ACTOR_CLASS} style={{color: entry.actor.color}}>
				{entry.actor.name}
			</span>
		)}
		{entry.diff && touchedLines(entry.diff) && (
			<span className={LOG_DIFF_CLASS}>
				<DiffStat {...entry.diff} bar={false} />
			</span>
		)}
		{showLabel && entry.label}
	</div>
);

// What each line shows, chosen at the top of the panel. Quiet when ticked:
// four lit boxes would outshine the lines they are about.
const LogHeader = ({
	fields,
	onChangeField,
	split,
	onChangeSplit,
	canSplit,
	children,
}: {
	fields: LogFields;
	onChangeField: (field: LogField, on: boolean) => void;
	// One lane per actor rather than one column for everybody.
	split: boolean;
	onChangeSplit: (next: boolean) => void;
	// False where the slice names nobody: there would be no lanes to draw.
	canSplit: boolean;
	// Whatever else the header carries, at its far end.
	children?: React.ReactNode;
}) => (
	<div
		data-testid="event-log-header"
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 12,
			flexShrink: 0,
			height: LOG_HEADER_HEIGHT,
			padding: `0 ${LOG_PANE_PADDING_X}px 0 30px`,
			borderBottom: `1px solid ${GUI_THEME.line}`,
		}}
	>
		{LOG_FIELD_ORDER.map(field => {
			// The name column is folded away while the log is split — the lane it
			// is in says who — so its box stands down rather than claiming to show
			// a column that is not there.
			const spoken = field === 'actor' && split && canSplit;

			return (
				<Checkbox
					key={field}
					label={LOG_FIELD_NAMES[field]}
					checked={fields[field] && !spoken}
					disabled={spoken}
					activeColor={GUI_THEME.secondary}
					title={
						spoken
							? 'The lane says who'
							: `${fields[field] ? 'Hide' : 'Show'} the ${LOG_FIELD_NAMES[
									field
							  ].toLowerCase()} on each line`
					}
					onChange={on => onChangeField(field, on)}
				/>
			);
		})}
		{/* Not one of the fields, so it is not worn as a box and does not stand
		    among them: those say what a line shows, this says where the line is
		    put. It sits with the panel's own buttons at the far end. */}
		<span
			style={{
				marginLeft: 'auto',
				display: 'inline-flex',
				alignItems: 'center',
			}}
		>
			<IconButton
				testId="log-split"
				title={
					canSplit
						? 'Give each actor a lane of their own'
						: 'Nobody signed these lines'
				}
				aria-label="Split"
				pressed={split && canSplit}
				disabled={!canSplit}
				onClick={() => onChangeSplit(!split)}
			>
				<IconColumns size={ICON_SIZE} />
			</IconButton>

			{children}
		</span>
	</div>
);

// Who each lane is, across the top of the pane. The lines scroll under it —
// see the sticky rule in EVENT_LOG_STYLES — because a lane is only a position
// until something names it, and the name column is folded away while split.
const LaneHeadings = ({lanes}: {lanes: readonly LogLane[]}) => (
	<div data-testid="log-lane-heads" className={LOG_LANE_HEAD_CLASS}>
		{lanes.map(lane => (
			<span key={lane.name} style={{color: lane.color}} title={lane.name}>
				{lane.name}
			</span>
		))}
	</div>
);

const EventLogPanel = ({
	entries,
	moment,
	bottomClearance,
	onOpen,
	onHoverEvent,
	layout = 'panel',
	onPopOut,
	onDock,
}: {
	entries: readonly LogEntry[];
	// The moment the lines were sliced against. Moving it is moving the
	// timeline, and the pane snaps to its foot for that — see below.
	moment: number;
	// Following a line. One handler on the pane rather than one per row: the
	// rows carry where they go, and hundreds of closures would be the expensive
	// half of a feature whose whole point is that it costs nothing until used.
	onOpen: (destination: LogDestination) => void;
	// The event under the pointer, or null off the rows: what the chart lights
	// up while a row is hovered.
	onHoverEvent?: (eventId: string | null) => void;
	// Room to leave at the foot of the column for whatever is floating over it —
	// the history player's drawer, when one is up. A row past it, because the
	// crawl starts each line one row low and slides it up.
	bottomClearance: number;
	// A panel beside the board, dragged to width; or a window of its own, which
	// it fills — see lib/log-window.
	layout?: 'panel' | 'window';
	// Sends the log to a window of its own. Absent where it cannot go anywhere.
	onPopOut?: () => void;
	// Brings a popped-out log back beside the board.
	onDock?: () => void;
}) => {
	const animate = !usePrefersReducedMotion();
	const {fields, setField} = useLogFields();
	const [splitWanted, setSplitWanted] = useLogSplit();
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const columnRef = useRef<HTMLDivElement | null>(null);

	// A day the reader has folded or opened by hand, against the default of the
	// newest day alone. Keyed by day, so it outlives the slice moving under it.
	const [foldOverrides, setFoldOverrides] = useState<
		ReadonlyMap<string, boolean>
	>(() => new Map());

	// Walked when the log moves, not when the board beside it repaints — which
	// during a movie is every animation frame.
	const days = useMemo(() => groupByDay(entries), [entries]);
	const actorChars = useMemo(() => actorColumnChars(entries), [entries]);

	const newestId = entries[entries.length - 1]?.id ?? null;

	// How many rows the pane has room for, so the days opened by default fill it
	// rather than leaving it mostly empty. Null until it has been measured.
	const [paneRows, setPaneRows] = useState<number | null>(null);
	// And how wide it is, which is how many lanes it can hold — see
	// lib/log-lanes. Zero until measured, which caps the lanes at one rather
	// than drawing a pane's worth of them before the pane is known.
	const [paneWidth, setPaneWidth] = useState(0);

	// The lanes are the actors in the slice on screen, so they follow it as the
	// moment moves rather than standing for a board nobody in this window
	// touched — see lib/log-lanes.
	const lanes = useMemo(
		() => logLanes(entries, laneCapacity(paneWidth)),
		[entries, paneWidth],
	);
	const laneIndexes = useMemo(() => laneIndexByName(lanes), [lanes]);
	const split = splitWanted && lanes.length > 0;

	const openCount = useMemo(
		() =>
			paneRows === null
				? Math.min(DEFAULT_OPEN_DAYS, days.length)
				: daysToOpen(days, paneRows),
		[days, paneRows],
	);

	// Whether the pane was at the foot before this render's rows landed, which is
	// what decides whether it follows them down.
	const pinnedRef = useRef(true);

	const onScroll = () => {
		const pane = scrollRef.current;
		if (!pane) return;

		pinnedRef.current =
			pane.scrollHeight - pane.scrollTop - pane.clientHeight <= PINNED_SLACK_PX;
	};

	// Measured off the pane's own height, which does not depend on what is in it
	// — so opening days to fill the pane cannot feed back into how many fit.
	// Before paint, so the first frame is already filled rather than showing one
	// day and then growing.
	useLayoutEffect(() => {
		const pane = scrollRef.current;
		if (!pane) return;

		const measure = () => {
			const usable = pane.clientHeight - bottomClearance - LOG_ROW_HEIGHT * 2;

			setPaneRows(Math.max(1, Math.floor(usable / LOG_ROW_HEIGHT)));
			setPaneWidth(pane.clientWidth);
		};

		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(pane);

		return () => observer.disconnect();
	}, [bottomClearance]);

	// The arrow that marks the row under the pointer is one node for the whole
	// panel, carried to whichever row that is. Moved through its ref rather
	// than by state: hovering sweeps across rows, and re-rendering the column
	// at every one of them is the cost this panel is built to avoid.
	const arrowRef = useRef<HTMLSpanElement>(null);

	// An absolutely positioned child extends the pane's scrollable overflow,
	// hidden or not. So an arrow left on a row the column has since lost is a
	// stretch of empty pane below the last line, and a snap to the foot lands in
	// it — showing nothing until the log grows back down to where the row was.
	// Called before either snap above: past the end of the column the arrow
	// marks nothing, and goes back to the top where it takes no room.
	const parkStrayArrow = () => {
		const arrow = arrowRef.current;
		const column = columnRef.current;
		if (!arrow || !column) return;

		if (arrow.offsetTop < column.offsetTop + column.offsetHeight) return;

		arrow.style.top = '0px';
		arrow.style.opacity = '0';
	};

	// Before paint, so a line arriving never shows the pane a frame out of place.
	// Only while the reader is at the foot: scrolled back, the log is something
	// being read, and pulling it to the bottom would take that away.
	useLayoutEffect(() => {
		const pane = scrollRef.current;
		if (!pane || !pinnedRef.current) return;

		parkStrayArrow();
		pane.scrollTop = pane.scrollHeight;
	}, [newestId, days.length, foldOverrides, openCount]);

	// Moving the timeline is different from a line arriving: reading back
	// through the log is reading the moment the board stands at, and once that
	// moment changes the place being read is gone with it. So the pane goes to
	// the foot whether or not it was there — and is pinned again, so what lands
	// next follows. Without this a scrub that shortens the log by hundreds of
	// lines left the pane scrolled to where they used to be, showing nothing.
	useLayoutEffect(() => {
		const pane = scrollRef.current;
		if (!pane) return;

		pinnedRef.current = true;
		parkStrayArrow();
		pane.scrollTop = pane.scrollHeight;
	}, [moment]);

	// The keys on screen before this render. The column slides by however many
	// rows joined the bottom, which is not always one: an event that crosses
	// midnight brings a day divider down with it, and a fixed shift would leave
	// the crawl stepping at every boundary.
	const shownKeysRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		const column = columnRef.current;
		const shown = shownKeysRef.current;
		const onScreen = days.flatMap((day, index) =>
			isDayOpen(days, index, foldOverrides, openCount)
				? [day.key, ...day.entries.map(entry => entry.id)]
				: [day.key],
		);
		const appended = onScreen.filter(key => !shown.has(key)).length;

		shownKeysRef.current = new Set(onScreen);

		// Not while scrolled back: the crawl is the newest line arriving at the
		// foot, and there is nothing to say about that from up the page.
		if (
			!column ||
			!animate ||
			newestId === null ||
			appended === 0 ||
			!pinnedRef.current
		) {
			return;
		}

		column.animate(crawlShiftFrames(appended), CRAWL_TIMING);
		// Deliberately keyed on the newest line rather than on `days`, which is
		// rebuilt every render: the crawl moves when the log does, not when the
		// board beside it repaints.
	}, [newestId, animate]);

	const markRow = (target: EventTarget | null) => {
		const arrow = arrowRef.current;
		if (!arrow) return;

		const row = linkedRowFrom(target);
		// `offsetTop` is inside the scrolled column, which is what the arrow is
		// positioned in too — so it rides the scroll with the row it is on.
		if (row) arrow.style.top = `${row.offsetTop}px`;
		arrow.style.opacity = row ? '1' : '0';

		// Split, a row ends at its own lane rather than at the pane, so the arrow
		// goes to the end of the line instead of to the far right, where it would
		// hang over lanes the row has nothing to do with.
		if (row && split) {
			arrow.style.right = 'auto';
			arrow.style.left = `${
				row.offsetLeft + row.offsetWidth - arrow.offsetWidth
			}px`;
		} else if (!split) {
			arrow.style.right = '';
			arrow.style.left = '';
		}
	};

	// Dragged to size from its board-side edge and remembered, as the ticket
	// panel on the other side is.
	const resize = useResizableWidth({
		storageKey: LOG_WIDTH_STORAGE_KEY,
		fallback: LOG_WIDTH,
		min: MIN_LOG_WIDTH,
		max: () => Math.min(MAX_LOG_WIDTH, window.innerWidth * MAX_LOG_RATIO),
		grows: 'right',
	});

	const inWindow = layout === 'window';

	return (
		<aside
			data-testid="event-log"
			aria-live="off"
			style={
				{
					position: 'relative',
					width: inWindow ? '100%' : resize.width,
					flexShrink: 0,
					minHeight: 0,
					display: 'flex',
					flexDirection: 'column',
					borderRight: inWindow ? 'none' : `1px solid ${GUI_THEME.line}`,
					background: GUI_THEME.panel,
					// The name column's width, for every row at once.
					[LOG_ACTOR_WIDTH_PROPERTY]: actorColumnWidth(actorChars),
					// How many lanes the pane divides into while it is split.
					[LOG_LANE_COUNT_PROPERTY]: lanes.length,
				} as React.CSSProperties
			}
		>
			<style>{EVENT_LOG_STYLES}</style>

			{!inWindow && (
				<ResizeHandle
					edge="right"
					active={resize.dragging}
					onPointerDown={resize.onPointerDown}
					testId="event-log-resize"
				/>
			)}

			<LogHeader
				fields={fields}
				onChangeField={setField}
				split={splitWanted}
				onChangeSplit={setSplitWanted}
				canSplit={lanes.length > 0}
			>
				{onPopOut && (
					<IconButton
						testId="log-pop-out"
						title="Open the log in its own window"
						onClick={onPopOut}
					>
						<IconPopOut size={ICON_SIZE} />
					</IconButton>
				)}
				{onDock && (
					<IconButton
						testId="log-dock"
						title="Put the log back beside the board"
						onClick={onDock}
					>
						<IconLog size={ICON_SIZE} />
					</IconButton>
				)}
			</LogHeader>

			<div
				ref={scrollRef}
				className={`epiq-log-pane ${logPaneClassName(fields)} ${
					split ? LOG_SPLIT_CLASS : ''
				}`
					.replace(/\s+/g, ' ')
					.trim()}
				onScroll={onScroll}
				onClick={event => {
					const destination = readDestination(event.target);
					if (destination) onOpen(destination);
				}}
				// One pair of handlers for the pane, like the click above: the rows
				// say where they go, and hundreds of listeners would be the costly
				// half of a panel whose lines are one node each.
				onMouseOver={event => {
					markRow(event.target);
					onHoverEvent?.(
						(event.target as Element)
							.closest('[data-event-id]')
							?.getAttribute('data-event-id') ?? null,
					);
				}}
				onMouseLeave={() => {
					markRow(null);
					onHoverEvent?.(null);
				}}
				data-testid="event-log-scroll"
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: 'auto',
					overflowX: 'hidden',
					// The arrow is placed against this, in the column's own
					// coordinates rather than the window's.
					position: 'relative',
					// A column, so the block below can push itself down with an auto
					// margin. `justify-content: flex-end` would do the same until the
					// content overflowed, at which point it puts the overflow above the
					// scrollable area, where it cannot be reached.
					display: 'flex',
					flexDirection: 'column',
					padding: `0 ${LOG_PANE_PADDING_X}px ${
						bottomClearance + LOG_ROW_HEIGHT * 2
					}px 30px`,
				}}
			>
				{/* Hidden until a row that leads somewhere is under the pointer, and
				    inert throughout — the row is what takes the click. */}
				<span
					ref={arrowRef}
					className={LOG_ARROW_CLASS}
					data-testid="log-row-arrow"
					aria-hidden="true"
				>
					<IconArrowUpRight size={11} />
				</span>

				{split && <LaneHeadings lanes={lanes} />}

				{/* Holds a short log at the foot of the panel, so the newest line is
				    always in the same place however few of them there are. */}
				<div ref={columnRef} style={{marginTop: 'auto'}}>
					{days.map((day, index) => {
						const open = isDayOpen(days, index, foldOverrides, openCount);

						return (
							<div key={day.key}>
								<DayDivider
									label={day.label}
									count={day.entries.length}
									open={open}
									onToggle={() =>
										setFoldOverrides(previous => {
											const next = new Map(previous);
											next.set(day.key, !open);
											return next;
										})
									}
								/>

								{/* A folded day is its divider and nothing else: no rows are
								    built for it, so what the panel costs is what is open. */}
								{open && (
									<div className={LOG_LANES_CLASS}>
										{day.entries.map(entry => (
											<EventRow
												key={entry.id}
												entry={entry}
												showLabel={fields.label}
												lane={
													split
														? laneIndexOf(entry, lanes, laneIndexes)
														: undefined
												}
											/>
										))}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</aside>
	);
};

// Memoised: the board re-renders on every frame of a movie, and the panel's
// props change only when the log itself does.
export const EventLog = memo(EventLogPanel);
