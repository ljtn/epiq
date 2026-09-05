// Everything the time scrubber computes or remembers, with no JSX. The chart
// parts and the component that arranges them draw against this.

export {
	clamp,
	isLayoutMode,
	TRACK_HEIGHT,
	EVENTS_SCATTER_HEIGHT,
	EVENTS_MODE_VERTICAL_PADDING,
	TRACK_HIT_PADDING,
	HOVER_HINT_WIDTH,
	SEGMENT_HIGHLIGHT_COLOR,
	BUCKET_HIGHLIGHT_COLOR,
	NEEDLE_COLOR,
	SCOPED_OUTLINE_COLOR,
	SCOPED_OUTLINE_INSET_X,
	SCOPED_OUTLINE_INSET_Y,
	RANGE_SELECTION_COLOR,
	RANGE_SELECTION_EDGE,
	NEEDLE_GRIP_WIDTH,
	MIN_RANGE_DRAG_PX,
	MIN_ZOOM_SPAN_MS,
	barWidthCss,
} from './layout';
export type {LayoutMode} from './layout';
export {
	bucketCountForSpan,
	buildAxis,
	bucketIssueCounts,
	bucketCommitStats,
	populatedRange,
	hourFractionForTime,
} from './axis';
export type {ScrubberAxis, CommitBucketStats, VolumeBar} from './axis';
export {
	EVENT_CATEGORIES,
	BOARD_VIEWS,
	isBoardView,
	boardViewColor,
	identityAxisFor,
	categoryOf,
	identityOf,
	listIdentities,
	soleVisibleIdentity,
} from './categories';
export type {EventCategory, BoardView} from './categories';
export {dotDetail, isShown, buildEventDots} from './dots';
export type {EventDot} from './dots';
export {chooseSegmentUnit, segmentAt, formatInterval} from './segments';
export type {SegmentUnit, Segment} from './segments';
export {
	SCOPES,
	isScope,
	isPeriodWindow,
	getPeriodRange,
	formatPeriodLabel,
	scopeButtonLabel,
} from './scope';
export type {Scope, PeriodRange} from './scope';
export {
	dotEntranceScale,
	dotExitScale,
	dotAppearAnimation,
	dotExitAnimation,
	DOT_EXIT_TOTAL_MS,
	barGrowAnimation,
	BAR_ENTRANCE_TOTAL_MS,
	FADE_IN_ANIMATION,
	SCRUBBER_KEYFRAMES,
} from './animation';
export {
	useNarrowBar,
	usePrefersReducedMotion,
	useExitTransition,
	usePersistedFlag,
} from './hooks';
export type {SeriesPresence} from './hooks';
export {
	buildBoardFilter,
	windowNamesIssues,
	windowIssueIds,
	issuePassesBoardFilter,
} from './board-filter';
export type {BoardFilter} from './board-filter';
