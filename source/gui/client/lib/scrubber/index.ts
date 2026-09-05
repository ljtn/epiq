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
	dotEntranceScale,
	dotExitScale,
	dotAppearAnimation,
	dotExitAnimation,
	DOT_EXIT_TOTAL_MS,
	barGrowAnimation,
	BAR_ENTRANCE_TOTAL_MS,
	FADE_IN_ANIMATION,
	SCRUBBER_KEYFRAMES,
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
	dotDetail,
	isShown,
	buildEventDots,
	buildBoardFilter,
	windowNamesIssues,
	windowIssueIds,
	issuePassesBoardFilter,
} from './series';
export type {EventCategory, BoardView, EventDot, BoardFilter} from './series';
export {
	chooseSegmentUnit,
	segmentAt,
	formatInterval,
	SCOPES,
	isScope,
	isPeriodWindow,
	getPeriodRange,
	formatPeriodLabel,
	scopeButtonLabel,
} from './time';
export type {SegmentUnit, Segment, Scope, PeriodRange} from './time';
export {
	useNarrowBar,
	usePrefersReducedMotion,
	useExitTransition,
	usePersistedFlag,
} from './hooks';
export type {SeriesPresence} from './hooks';
