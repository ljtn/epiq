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
	LOG_DOT_COLOR_PROPERTY,
	LOG_ROW_HEIGHT,
} from '../lib/event-log';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {usePrefersReducedMotion} from '../lib/scrubber';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';

const LOG_WIDTH = 380;

// How many rows the top of the log dissolves over. Measured in rows rather than
// as a share of anything, so the fade is the same depth whatever height the
// panel happens to have.
const FADE_ROWS = 3;

// Dissolves the top of the pane so lines leave rather than being cut off. Both
// spellings, since the unprefixed property is not in Safari.
const CRAWL_MASK = `linear-gradient(to bottom, transparent 0, #000 ${
	FADE_ROWS * LOG_ROW_HEIGHT
}px)`;

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

// One element, and one text node inside it. The clock and the kind dot are
// pseudo-elements of this row rather than spans in it — see EVENT_LOG_STYLES —
// because the panel holds hundreds of these and three spans apiece is three
// hundred nodes of nothing.
const EventRow = ({entry}: {entry: LogEntry}) => (
	<div
		data-testid="log-line"
		className="epiq-log-line"
		data-time={formatTimeOfDay(new Date(entry.t))}
		style={{[LOG_DOT_COLOR_PROPERTY]: entry.color} as React.CSSProperties}
	>
		{entry.label}
	</div>
);

const EventLogPanel = ({
	entries,
	bottomClearance,
}: {
	entries: readonly LogEntry[];
	// Room to leave at the foot of the column for whatever is floating over it —
	// the history player's drawer, when one is up. A row past it, because the
	// crawl starts each line one row low and slides it up.
	bottomClearance: number;
}) => {
	const animate = !usePrefersReducedMotion();
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
	const newestId = entries[entries.length - 1]?.id ?? null;

	// How many rows the pane has room for, so the days opened by default fill it
	// rather than leaving it mostly empty. Null until it has been measured.
	const [paneRows, setPaneRows] = useState<number | null>(null);

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
		};

		measure();

		const observer = new ResizeObserver(measure);
		observer.observe(pane);

		return () => observer.disconnect();
	}, [bottomClearance]);

	// Before paint, so a line arriving never shows the pane a frame out of place.
	// Only while the reader is at the foot: scrolled back, the log is something
	// being read, and pulling it to the bottom would take that away.
	useLayoutEffect(() => {
		const pane = scrollRef.current;
		if (!pane || !pinnedRef.current) return;

		pane.scrollTop = pane.scrollHeight;
	}, [newestId, days.length, foldOverrides, openCount]);

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

	return (
		<aside
			data-testid="event-log"
			aria-live="off"
			style={{
				width: LOG_WIDTH,
				flexShrink: 0,
				minHeight: 0,
				display: 'flex',
				flexDirection: 'column',
				borderRight: `1px solid ${GUI_THEME.line}`,
				background: GUI_THEME.panel,
			}}
		>
			<style>{EVENT_LOG_STYLES}</style>

			<div
				ref={scrollRef}
				onScroll={onScroll}
				data-testid="event-log-scroll"
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: 'auto',
					overflowX: 'hidden',
					// A column, so the block below can push itself down with an auto
					// margin. `justify-content: flex-end` would do the same until the
					// content overflowed, at which point it puts the overflow above the
					// scrollable area, where it cannot be reached.
					display: 'flex',
					flexDirection: 'column',
					padding: `0 14px ${bottomClearance + LOG_ROW_HEIGHT * 2}px 30px`,
					maskImage: CRAWL_MASK,
					WebkitMaskImage: CRAWL_MASK,
				}}
			>
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
								{open &&
									day.entries.map(entry => (
										<EventRow key={entry.id} entry={entry} />
									))}
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
