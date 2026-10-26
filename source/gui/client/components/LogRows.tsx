// The event log's rows, shared by the panel and by a ticket's own activity.

import {formatTimeOfDay} from '../../../lib/utils/date.utils.js';
import {actorDisplay} from '../lib/agent-identity';
import {
	LogEntry,
	LOG_ACTOR_CLASS,
	LOG_DIFF_CLASS,
	LOG_REF_CLASS,
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

// The rows an open day holds back, inside the day, with its chevron.
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

// One element per row: the clock and kind dot are pseudo-elements (see
// EVENT_LOG_STYLES), and fields are shown by the pane's class, except the label.
export const EventRow = ({
	entry,
	showLabel,
	lane,
	followed = false,
}: {
	entry: LogEntry;
	showLabel: boolean;
	// The row's lane while split: null spans all lanes, undefined when not split.
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
		// A clipped row's full label, on hover.
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
		{showLabel && entry.ref && (
			<span className={LOG_REF_CLASS}>{entry.ref}</span>
		)}
		{showLabel && entry.label.slice(entry.ref?.length ?? 0)}
	</div>
);

// Who signed the line, without an agent's provider prefix (see lib/agent-identity).
// Quieter than the label.
const ActorName = ({name}: {name: string}) => (
	<span className={LOG_ACTOR_CLASS} title={name}>
		{actorDisplay(name).label}
	</span>
);
