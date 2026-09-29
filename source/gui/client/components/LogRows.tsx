// The event log's rows, shared by the panel and by a ticket's own activity.

import {formatTimeOfDay} from '../../../lib/utils/date.utils.js';
import {actorDisplay} from '../lib/agent-identity';
import {
	LogEntry,
	LOG_ACTOR_CLASS,
	LOG_DIFF_CLASS,
	LOG_DOT_COLOR_PROPERTY,
	LOG_LANE_ALL_CLASS,
	LOG_LANE_PROPERTY,
	LOG_ROW_HEIGHT,
	touchedLines,
} from '../lib/event-log';
import {rowAttributes} from '../lib/log-destination';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {DiffStat} from './DiffStat';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';

const dividerRuleStyle: React.CSSProperties = {
	flex: 1,
	height: 1,
	alignSelf: 'center',
	background: GUI_THEME.line,
};

export const DayDivider = ({
	label,
	count,
	open,
	onToggle,
}: {
	label: string;
	count: number;
	open: boolean;
	// Absent where days cannot fold: the divider is then only a date, and not
	// a control.
	onToggle?: () => void;
}) => {
	const style: React.CSSProperties = {
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
	};

	const content = (
		<>
			{onToggle && (
				<span
					aria-hidden
					style={{display: 'inline-flex', alignItems: 'center', flexShrink: 0}}
				>
					{open ? (
						<IconChevronDown size={11} />
					) : (
						<IconChevronRight size={11} />
					)}
				</span>
			)}
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
		</>
	);

	return onToggle ? (
		<button
			type="button"
			data-testid="log-day"
			aria-expanded={open}
			onClick={onToggle}
			title={open ? `Fold ${label}` : `Show the ${count} lines of ${label}`}
			style={{...style, cursor: 'pointer'}}
		>
			{content}
		</button>
	) : (
		<div data-testid="log-day" style={style}>
			{content}
		</div>
	);
};

// The rows an open day is holding back. Inside the day rather than above it,
// because what it opens is the rest of this day and not another one — and
// wearing the folded day's own chevron, since it says the same thing about the
// same kind of thing.
export const EarlierRow = ({
	hidden,
	label,
	onExpand,
}: {
	hidden: number;
	label: string;
	onExpand: () => void;
}) => (
	<button
		type="button"
		data-testid="log-day-earlier"
		onClick={onExpand}
		title={`Show the ${hidden} earlier lines of ${label}`}
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 8,
			width: '100%',
			height: LOG_ROW_HEIGHT,
			padding: 0,
			background: 'transparent',
			border: 'none',
			color: GUI_THEME.dim2,
			fontFamily: 'inherit',
			fontSize: TEXT.meta,
			cursor: 'pointer',
		}}
	>
		<span
			aria-hidden
			style={{display: 'inline-flex', alignItems: 'center', flexShrink: 0}}
		>
			<IconChevronRight size={11} />
		</span>
		<span style={{flexShrink: 0}}>{hidden} earlier</span>
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
export const EventRow = ({
	entry,
	showLabel,
	lane,
	followed = false,
}: {
	entry: LogEntry;
	showLabel: boolean;
	// Which lane the row sits in while the log is split: a number, null on a
	// line nobody signed — it spans them all — and undefined while the log is
	// not split, which leaves the row exactly as it was.
	lane?: number | null;
	// True on the one line the board is standing on while following.
	followed?: boolean;
}) => (
	<div
		data-testid="log-line"
		className={[
			'epiq-log-line',
			lane === null ? LOG_LANE_ALL_CLASS : '',
			followed ? 'epiq-log-line--followed' : '',
		]
			.filter(Boolean)
			.join(' ')}
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
		{entry.actor && <ActorName {...entry.actor} />}
		{entry.diff && touchedLines(entry.diff) && (
			<span className={LOG_DIFF_CLASS}>
				<DiffStat {...entry.diff} bar={false} />
			</span>
		)}
		{showLabel && entry.label}
	</div>
);

// Who signed the line. An agent's provider prefix goes — see
// lib/agent-identity — leaving the slash and the name; a person's name is
// written as it is, and the full name stays in the title.
//
// Quieter than the time beside it and the label after it, and in nobody's
// colour: a signature repeated down every row is what the eye should skip,
// not what it should land on.
const ActorName = ({name}: {name: string}) => (
	<span className={LOG_ACTOR_CLASS} title={name}>
		{actorDisplay(name).label}
	</span>
);
