// The board's event log: a panel down the left holding one timestamped line
// per event, the column sliding up by a row as each lands and the oldest lines
// dissolving off the top.
//
// A panel rather than a wash over the board — it takes its own width and the
// board moves over for it, so neither has to be read through the other.
//
// The rows it is handed are a slice taken against the moment the board is
// standing at, never a list grown as events arrive, so what is off the top is
// not merely invisible — it is not in the document at all, and the panel costs
// the same on a year of history as on an hour.

import {useEffect, useRef} from 'react';
import {
	formatDayLabel,
	formatTimeOfDay,
	formatWeekday,
	isSameDay,
} from '../../../lib/utils/date.utils.js';
import {
	crawlShiftFrames,
	CRAWL_TIMING,
	EVENT_LOG_KEYFRAMES,
	LogEntry,
	LOG_ROW_HEIGHT,
} from '../lib/event-log';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {usePrefersReducedMotion} from '../lib/scrubber';

const LOG_WIDTH = 380;

// How many rows the top of the log dissolves over. Measured in rows rather
// than as a share of anything, so the fade is the same depth whatever height
// the panel happens to have.
const FADE_ROWS = 3;

// Dissolves the top of the pane so lines leave rather than being cut off. Both
// spellings, since the unprefixed property is not in Safari.
const CRAWL_MASK = `linear-gradient(to bottom, transparent 0, #000 ${
	FADE_ROWS * LOG_ROW_HEIGHT
}px)`;

// A few pixels across, and no more: it marks a line's kind without becoming
// the thing the eye lands on.
const DOT_SIZE = 5;

const dividerRuleStyle: React.CSSProperties = {
	flex: 1,
	height: 1,
	alignSelf: 'center',
	background: GUI_THEME.line,
};

// The clock alone against each line, with the day called once above the lines
// that share it — a full date on all of them is the same ten characters twenty
// times over.
type Row =
	| {kind: 'day'; key: string; label: string}
	| {kind: 'event'; key: string; time: string; label: string; color: string};

const toRows = (entries: readonly LogEntry[]): Row[] => {
	const rows: Row[] = [];
	let previous: Date | null = null;

	for (const entry of entries) {
		const at = new Date(entry.t);

		if (!previous || !isSameDay(previous, at)) {
			rows.push({
				kind: 'day',
				key: `day-${entry.id}`,
				label: formatDayLabel(at),
			});
		}

		rows.push({
			kind: 'event',
			key: entry.id,
			// The weekday against every line, not only against the day it opens:
			// the header scrolls off the top long before the lines under it do,
			// and a bare clock says nothing about which day it belongs to.
			time: `${formatWeekday(at)} ${formatTimeOfDay(at)}`,
			label: entry.label,
			color: entry.color,
		});

		previous = at;
	}

	return rows;
};

export const EventLog = ({
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
	const columnRef = useRef<HTMLDivElement | null>(null);
	const rows = toRows(entries);
	const newestId = entries[entries.length - 1]?.id ?? null;

	// The keys on screen before this render. The column slides by however many
	// rows joined the bottom, which is not always one: an event that crosses
	// midnight brings a day header down with it, and a fixed shift would leave
	// the crawl stepping at every boundary.
	const shownKeysRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		const column = columnRef.current;
		const shown = shownKeysRef.current;
		const appended = rows.filter(row => !shown.has(row.key)).length;

		shownKeysRef.current = new Set(rows.map(row => row.key));

		if (!column || !animate || newestId === null || appended === 0) return;

		column.animate(crawlShiftFrames(appended), CRAWL_TIMING);
		// Deliberately keyed on the newest line rather than on `rows`, which is
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
				// The lines sit at the foot of the panel, so the newest is always in
				// the same place however few of them there are.
				justifyContent: 'flex-end',
				borderRight: `1px solid ${GUI_THEME.line}`,
				background: GUI_THEME.panel,
			}}
		>
			<style>{EVENT_LOG_KEYFRAMES}</style>

			<div
				style={{
					// The lines run the whole height of the panel and are cut off at
					// its top, where the fade is. Bounded to the pane rather than to a
					// row count, so the log reaches the top of whatever height it is
					// given instead of stopping short in a box of its own.
					flex: 1,
					minHeight: 0,
					display: 'flex',
					flexDirection: 'column',
					// Filled from the bottom, so a new line pushes the column up and the
					// oldest one off the top into the fade.
					justifyContent: 'flex-end',
					overflow: 'hidden',
					// The clearance keeps the lines off whatever floats over the foot of
					// the board; the two rows past it are what the crawl slides through
					// on its way up, which would otherwise be clipped as it went.
					padding: `0 14px ${bottomClearance + LOG_ROW_HEIGHT * 2}px 30px`,
					maskImage: CRAWL_MASK,
					WebkitMaskImage: CRAWL_MASK,
				}}
			>
				<div ref={columnRef}>
					{rows.map(row => (
						<div
							key={row.key}
							data-testid={row.kind === 'day' ? 'log-day' : 'log-line'}
							style={{
								display: 'flex',
								gap: 10,
								height: LOG_ROW_HEIGHT,
								lineHeight: `${LOG_ROW_HEIGHT}px`,
								fontSize: TEXT.meta,
								// One clipped line each, which is what makes the crawl even:
								// every row is the height the column slides by.
								whiteSpace: 'nowrap',
								animation: animate ? 'epiqLogLine 260ms ease-out' : undefined,
							}}
						>
							{row.kind === 'day' ? (
								// A rule either side of the day, so it reads as a divider
								// between one day's lines and the next rather than as another
								// line of the log.
								<>
									<span aria-hidden style={dividerRuleStyle} />
									<span
										style={{
											color: GUI_THEME.dim,
											flexShrink: 0,
										}}
									>
										{row.label}
									</span>
									<span aria-hidden style={dividerRuleStyle} />
								</>
							) : (
								<>
									<span
										style={{
											color: GUI_THEME.dim2,
											fontVariantNumeric: 'tabular-nums',
											flexShrink: 0,
										}}
									>
										{row.time}
									</span>
									{/* Between the clock and the line, so a run of them makes a
									    column of its own down the panel. */}
									<span
										data-testid="log-dot"
										aria-hidden
										style={{
											width: DOT_SIZE,
											height: DOT_SIZE,
											borderRadius: '50%',
											background: row.color,
											flexShrink: 0,
											alignSelf: 'center',
										}}
									/>
									<span
										style={{
											color: GUI_THEME.secondary,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
										}}
									>
										{row.label}
									</span>
								</>
							)}
						</div>
					))}
				</div>
			</div>
		</aside>
	);
};
