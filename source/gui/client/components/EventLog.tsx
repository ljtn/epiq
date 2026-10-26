// The board's event log: one line per event, grouped by day, newest day open.
// Stays pinned to the foot only while already there.

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
	dayRowsShown,
	EVENT_LOG_STYLES,
	groupByDay,
	isDayOpen,
	LogEntry,
	actorColumnWidthsByDay,
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
import {actorDisplay} from '../lib/agent-identity';
import {PANE_HEADER_INSET} from '../lib/pane-header.style';
import {LogFieldBox, LogFieldsMenu} from './LogFieldsMenu';
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
import {REVEAL_MS} from '../lib/use-reveal';
import {IconArrowUpRight} from './IconArrowUpRight';
import {IconButton, ICON_BUTTON_SIZE, ICON_SIZE} from './IconButton';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';
import {IconLog} from './IconLog';
import {IconPopOut} from './IconPopOut';
import {DayDivider, EarlierRow, EventRow} from './LogRows';

const LOG_WIDTH = 440;
// Narrow enough to still fit a line's time and a few words of it; wide
// enough at the top to read a whole subject, short of taking the board.
const MIN_LOG_WIDTH = 280;
const MAX_LOG_WIDTH = 1000;
const MAX_LOG_RATIO = 0.6;
const LOG_WIDTH_STORAGE_KEY = 'epiq.eventLog.width';
// The square an icon button makes, under the inset every pane's header keeps —
// so this row and the panel's on the other side of the board are one line.
const LOG_HEADER_HEIGHT = ICON_BUTTON_SIZE;

// Below this pane width the field boxes fold into a menu. A fixed width, since
// measuring the row would fold and unfold it forever.
const LOG_HEADER_FOLD_WIDTH = 400;

// How near the foot counts as at it.
const PINNED_SLACK_PX = LOG_ROW_HEIGHT * 2;

// The field toggles. Ticked shows in the box's fill, not its colour.
const LogHeader = ({
	fields,
	onChangeField,
	split,
	onChangeSplit,
	canSplit,
	folded,
	children,
}: {
	fields: LogFields;
	onChangeField: (field: LogField, on: boolean) => void;
	// One lane per actor rather than one column for everybody.
	split: boolean;
	onChangeSplit: (next: boolean) => void;
	// False where the slice names nobody: there would be no lanes to draw.
	canSplit: boolean;
	// The boxes fold into one menu rather than wrap.
	folded: boolean;
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
			// The same gap under the row as over it.
			padding: `${PANE_HEADER_INSET}px ${LOG_PANE_PADDING_X}px ${PANE_HEADER_INSET}px 30px`,
			borderBottom: `1px solid ${GUI_THEME.line}`,
		}}
	>
		{/* The name box stands down while split: the lane says who. */}
		{folded ? (
			<LogFieldsMenu
				fields={fields}
				onChangeField={onChangeField}
				spokenField={split && canSplit ? 'actor' : null}
			/>
		) : (
			LOG_FIELD_ORDER.map(field => (
				<LogFieldBox
					key={field}
					field={field}
					fields={fields}
					spoken={field === 'actor' && split && canSplit}
					onChangeField={onChangeField}
				/>
			))
		)}
		{/* Placement, not a field, so it sits with the panel's buttons. */}
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

// Lane names, sticky over the scrolling lines (see EVENT_LOG_STYLES).
const LaneHeadings = ({lanes}: {lanes: readonly LogLane[]}) => (
	<div data-testid="log-lane-heads" className={LOG_LANE_HEAD_CLASS}>
		{lanes.map(lane => (
			<span key={lane.name} title={lane.name}>
				{actorDisplay(lane.name).label}
			</span>
		))}
	</div>
);

const EventLogPanel = ({
	entries,
	moment,
	bottomClearance,
	onOpen,
	at = null,
	followedLine = null,
	eventsUnlisted = false,
	onPinnedChange,
	onHoverEvent,
	layout = 'panel',
	revealed = true,
	settled = true,
	onPopOut,
	onDock,
}: {
	// The pane's width; false is shut. Content keeps the open width and is clipped,
	// so nothing reflows. Both default to open, for the window.
	revealed?: boolean;
	settled?: boolean;
	entries: readonly LogEntry[];
	// The moment the lines were sliced against. Moving it is moving the
	// timeline, and the pane snaps to its foot for that — see below.
	moment: number;
	// One handler on the pane; rows carry their destination.
	onOpen: (destination: LogDestination, options?: {replace?: boolean}) => void;
	// Where the reader is, so following can tell "already there" from "went
	// there once". Null where nothing is open.
	at?: LogDestination | null;
	// The followed line, decided by the board.
	followedLine?: string | null;
	// The server won't list this many events, so only commits are shown.
	eventsUnlisted?: boolean;
	// Reported up: the board runs the follow, even from a popped-out panel.
	onPinnedChange?: (pinned: boolean) => void;
	// The event under the pointer, or null off the rows: what the chart lights
	// up while a row is hovered.
	onHoverEvent?: (eventId: string | null) => void;
	// Room at the foot for whatever floats over it, plus a row for the crawl.
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

	// Days the reader expanded. One-way, so landing lines don't fold them.
	const [expandedDays, setExpandedDays] = useState<ReadonlySet<string>>(
		() => new Set(),
	);

	// Walked when the log moves, not when the board beside it repaints — which
	// during a movie is every animation frame.
	const days = useMemo(() => groupByDay(entries), [entries]);
	const actorWidths = useMemo(() => actorColumnWidthsByDay(days), [days]);

	const newestId = entries[entries.length - 1]?.id ?? null;

	// How many rows the pane has room for, so the days opened by default fill it
	// rather than leaving it mostly empty. Null until it has been measured.
	const [paneRows, setPaneRows] = useState<number | null>(null);
	// Pane width sets how many lanes fit (see lib/log-lanes). Zero caps it at one.
	const [paneWidth, setPaneWidth] = useState(0);

	// The lanes are the actors in the slice on screen (see lib/log-lanes).
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

		const wasPinned = pinnedRef.current;
		pinnedRef.current =
			pane.scrollHeight - pane.scrollTop - pane.clientHeight <= PINNED_SLACK_PX;

		// Only on change: returning to the foot resumes a paused follow.
		if (wasPinned !== pinnedRef.current) onPinnedChange?.(pinnedRef.current);
	};

	// And once on mount: the board's value outlives this panel, which mounts
	// at its foot.
	useEffect(() => {
		onPinnedChange?.(pinnedRef.current);
	}, [onPinnedChange]);

	// Measured off the pane's own height, before paint.
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

	// One arrow node for the panel, moved by ref rather than state so hovering
	// doesn't re-render the column.
	const arrowRef = useRef<HTMLSpanElement>(null);

	// A positioned child extends the scrollable overflow, so an arrow left past the
	// column's end leaves empty pane at the foot. Called before either snap.
	const parkStrayArrow = () => {
		const arrow = arrowRef.current;
		const column = columnRef.current;
		if (!arrow || !column) return;

		if (arrow.offsetTop < column.offsetTop + column.offsetHeight) return;

		arrow.style.top = '0px';
		arrow.style.opacity = '0';
	};

	// Keeps the pane at the foot as lines arrive, if it was there; before paint.
	useLayoutEffect(() => {
		const pane = scrollRef.current;
		if (!pane || !pinnedRef.current) return;

		parkStrayArrow();
		pane.scrollTop = pane.scrollHeight;
	}, [newestId, days.length, foldOverrides, openCount]);

	// Moving the timeline sends the pane to the foot and re-pins it, wherever it was.
	useLayoutEffect(() => {
		const pane = scrollRef.current;
		if (!pane) return;

		pinnedRef.current = true;
		// The scroll below re-enters onScroll already pinned, so report it here.
		onPinnedChange?.(true);
		parkStrayArrow();
		pane.scrollTop = pane.scrollHeight;
	}, [moment, onPinnedChange]);

	// Keys on screen before this render. The crawl shifts by however many rows
	// joined, since a day divider can arrive with an event.
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
		// Keyed on the newest line, not on `days`, which is rebuilt every render.
	}, [newestId, animate]);

	const markRow = (target: EventTarget | null) => {
		const arrow = arrowRef.current;
		if (!arrow) return;

		const row = linkedRowFrom(target);
		// `offsetTop` is inside the scrolled column, which is what the arrow is
		// positioned in too — so it rides the scroll with the row it is on.
		if (row) arrow.style.top = `${row.offsetTop}px`;
		arrow.style.opacity = row ? '1' : '0';

		// Split, the arrow goes to the end of the row's own lane.
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
			// The edge is a grab target, still moving until this is true.
			data-settled={settled ? 'true' : 'false'}
			aria-live="off"
			style={
				{
					position: 'relative',
					width: inWindow ? '100%' : revealed ? resize.width : 0,
					flexShrink: 0,
					minHeight: 0,
					display: 'flex',
					flexDirection: 'column',
					// Only while it is moving: the resize handle stands on this edge
					// and would be cut in half by a clip left on.
					overflow: settled ? undefined : 'hidden',
					// Not while it is being dragged to size — the pointer is already
					// the animation, and a transition makes the edge lag behind it.
					transition:
						inWindow || resize.dragging || !animate
							? undefined
							: `width ${REVEAL_MS}ms ease`,
					// The board-facing edge with a shadow, like the ticket panel's; half the alpha,
					// since this pane sits on the chrome's darker ground.
					borderRight: inWindow
						? 'none'
						: `1px solid ${GUI_THEME.edgeOnChrome}`,
					boxShadow: inWindow ? undefined : '10px 0 24px rgba(0, 0, 0, 0.45)',
					background: GUI_THEME.chrome,
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

			{/* Holds the open width while the pane resizes, so nothing reflows. */}
			<div
				style={{
					width: inWindow ? '100%' : resize.width,
					flex: 1,
					minHeight: 0,
					display: 'flex',
					flexDirection: 'column',
				}}
			>
				<LogHeader
					fields={fields}
					onChangeField={setField}
					split={splitWanted}
					onChangeSplit={setSplitWanted}
					canSplit={lanes.length > 0}
					// Unmeasured counts as wide, so nothing folds on the first paint.
					folded={paneWidth > 0 && paneWidth < LOG_HEADER_FOLD_WIDTH}
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
					// One pair of handlers for the pane, as with the click.
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
						// A column, so the block below can sit at the foot with an auto margin;
						// `justify-content: flex-end` would make overflow unreachable.
						display: 'flex',
						flexDirection: 'column',
						padding: `0 ${LOG_PANE_PADDING_X}px ${
							bottomClearance + LOG_ROW_HEIGHT * 2
						}px 30px`,
					}}
				>
					{/* Shown on a row that leads somewhere; inert, the row takes the click. */}
					<span
						ref={arrowRef}
						className={LOG_ARROW_CLASS}
						data-testid="log-row-arrow"
						aria-hidden="true"
					>
						<span
							style={{
								fontSize: 9,
								fontWeight: 600,
								letterSpacing: 0.5,
								textTransform: 'uppercase',
							}}
						>
							View
						</span>
						<IconArrowUpRight size={11} />
					</span>

					{split && <LaneHeadings lanes={lanes} />}

					{/* Holds a short log at the foot of the panel, so the newest line is
				    always in the same place however few of them there are. */}
					<div ref={columnRef} style={{marginTop: 'auto'}}>
						{/* Inside the column, so it hangs at the foot with the lines. */}
						{eventsUnlisted && (
							<div
								data-testid="log-events-unlisted"
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 6,
									margin: `4px ${LOG_PANE_PADDING_X}px 8px`,
									padding: '5px 8px',
									borderLeft: `2px solid ${GUI_THEME.dim2}`,
									color: GUI_THEME.dim2,
									fontSize: TEXT.meta,
									lineHeight: 1.4,
								}}
							>
								Too many events in this window to list one by one — narrow the
								window to read them. The chart above still counts them all.
							</div>
						)}

						{days.map((day, index) => {
							const open = isDayOpen(days, index, foldOverrides, openCount);
							const {shown, hidden} = dayRowsShown(
								day,
								expandedDays.has(day.key),
							);

							return (
								<div
									key={day.key}
									// Inline wins over the pane's classes, so it is set only
									// while the name column is drawn.
									style={
										fields.actor && !split
											? ({
													[LOG_ACTOR_WIDTH_PROPERTY]: actorWidths[index],
											  } as React.CSSProperties)
											: undefined
									}
								>
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
											{hidden > 0 && (
												<EarlierRow
													hidden={hidden}
													label={day.label}
													onExpand={() =>
														setExpandedDays(previous =>
															new Set(previous).add(day.key),
														)
													}
												/>
											)}
											{shown.map(entry => (
												<EventRow
													key={entry.id}
													entry={entry}
													showLabel={fields.label}
													followed={entry.id === followedLine}
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
			</div>
		</aside>
	);
};

// Memoised: the board re-renders on every frame of a movie, and the panel's
// props change only when the log itself does.
export const EventLog = memo(EventLogPanel);
