// A ticket's own events and commits, drawn with the event log's rows and
// nothing else of it: no fields, lanes, folding or chart link.

import {useMemo, useState} from 'react';
import {
	actorColumnWidthsByDay,
	EVENT_LOG_STYLES,
	groupByDay,
	LogEntry,
	LOG_ACTOR_WIDTH_PROPERTY,
} from '../lib/event-log';
import {Empty} from './FormPrimitives';
import {DayDivider, EarlierRow, EventRow} from './LogRows';
import {Section} from './Section';

// The newest few; the rest wait behind "earlier".
export const ACTIVITY_SHOWN = 8;

export const IssueActivity = ({
	entries,
}: {
	// Oldest first, as the log reads.
	entries: readonly LogEntry[];
}) => {
	const [all, setAll] = useState(false);
	const hidden = all ? 0 : Math.max(0, entries.length - ACTIVITY_SHOWN);
	const days = useMemo(
		() => groupByDay(entries.slice(hidden)),
		[entries, hidden],
	);
	const widths = useMemo(() => actorColumnWidthsByDay(days), [days]);

	return (
		<Section title="Activity">
			{entries.length === 0 ? (
				<Empty>No activity yet</Empty>
			) : (
				<div
					data-testid="issue-activity"
					className="epiq-log-pane"
					style={{marginTop: 10}}
				>
					<style>{EVENT_LOG_STYLES}</style>
					{hidden > 0 && (
						<EarlierRow
							hidden={hidden}
							label="this ticket"
							onExpand={() => setAll(true)}
						/>
					)}
					{days.map((day, index) => (
						<div
							key={day.key}
							style={
								{
									[LOG_ACTOR_WIDTH_PROPERTY]: widths[index],
								} as React.CSSProperties
							}
						>
							<DayDivider label={day.label} count={day.entries.length} open />
							{day.entries.map(entry => (
								<EventRow key={entry.id} entry={entry} showLabel />
							))}
						</div>
					))}
				</div>
			)}
		</Section>
	);
};
