// The movie's log: a panel down the left of the board holding one timestamped
// line per event as it lands, the column sliding up by a row each time and the
// oldest lines dissolving off the top.
//
// A panel rather than a wash over the board — it takes its own width and the
// board moves over for it, so neither has to be read through the other.
//
// The rows are a slice of the script rather than a list grown as events arrive,
// so what is off the top is not merely invisible — it is not in the document at
// all, and the panel costs the same at the end of a long movie as at the start.

import {useEffect, useRef} from 'react';
import {
	formatDate,
	formatTimeOfDay,
	isSameDay,
} from '../../../lib/utils/date.utils.js';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {usePrefersReducedMotion} from '../lib/scrubber';
import {
	crawlShiftFrames,
	THEATRE_CRAWL_TIMING,
	THEATRE_LOG_ROW_HEIGHT,
	THEATRE_PLAYER_CLEARANCE,
	TheatreEvent,
} from '../lib/theatre';

const LOG_WIDTH = 380;

// Dissolves the top of the column so lines leave rather than being clipped off.
// On the column alone, not the panel: the panel keeps its edges. Both spellings,
// since the unprefixed property is not in Safari.
const CRAWL_MASK = 'linear-gradient(to bottom, transparent 0%, #000 34%)';

// The clock alone against each line, with the day called once above the lines
// that share it — a full date on all of them is the same ten characters twenty
// times over.
type LogRow =
	| {kind: 'day'; key: string; label: string}
	| {kind: 'event'; key: string; time: string; label: string};

const toRows = (entries: TheatreEvent[]): LogRow[] => {
	const rows: LogRow[] = [];
	let previous: Date | null = null;

	for (const entry of entries) {
		const at = new Date(entry.t);

		if (!previous || !isSameDay(previous, at)) {
			rows.push({kind: 'day', key: `day-${entry.id}`, label: formatDate(at)});
		}

		rows.push({
			kind: 'event',
			key: entry.id,
			time: formatTimeOfDay(at),
			label: entry.label,
		});

		previous = at;
	}

	return rows;
};

export const TheatreLog = ({entries}: {entries: TheatreEvent[]}) => {
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

		column.animate(crawlShiftFrames(appended), THEATRE_CRAWL_TIMING);
		// Deliberately keyed on the newest line rather than on `rows`, which is
		// rebuilt every render: the crawl moves when the log does, not when the
		// board above it repaints.
	}, [newestId, animate]);

	return (
		<aside
			data-testid="theatre-log"
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
			<div
				style={{
					flex: 1,
					minHeight: 0,
					display: 'flex',
					flexDirection: 'column',
					// Filled from the bottom, so a new line pushes the column up and the
					// oldest one off the top into the fade.
					justifyContent: 'flex-end',
					overflow: 'hidden',
					// A row's worth past the drawer: the crawl starts each line one
					// row low and slides it up, and at rest against the drawer that
					// slide would run the newest line in behind it.
					padding: `0 14px ${
						THEATRE_PLAYER_CLEARANCE + THEATRE_LOG_ROW_HEIGHT
					}px 30px`,
					maskImage: CRAWL_MASK,
					WebkitMaskImage: CRAWL_MASK,
				}}
			>
				<div ref={columnRef}>
					{rows.map(row => (
						<div
							key={row.key}
							data-testid={
								row.kind === 'day' ? 'theatre-log-day' : 'theatre-log-line'
							}
							style={{
								display: 'flex',
								gap: 10,
								height: THEATRE_LOG_ROW_HEIGHT,
								lineHeight: `${THEATRE_LOG_ROW_HEIGHT}px`,
								fontSize: TEXT.meta,
								// One clipped line each, which is what makes the crawl even:
								// every row is the height the column slides by.
								whiteSpace: 'nowrap',
								animation: animate
									? 'epiqTheatreLogLine 260ms ease-out'
									: undefined,
							}}
						>
							{row.kind === 'day' ? (
								<span
									style={{
										color: GUI_THEME.dim,
										fontVariantNumeric: 'tabular-nums',
									}}
								>
									{row.label}
								</span>
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
