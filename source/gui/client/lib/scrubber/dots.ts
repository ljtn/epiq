import {maxOf} from '../../../../lib/utils/minmax.js';
import {
	GuiEventIdentity,
	GuiEventTimeline,
	GuiEventTimelineEntry,
} from '../gui-state.model';
import {EVENT_CATEGORY_COLORS, GUI_THEME} from '../gui-theme';
import {EventCategory, BoardView, categoryOf, identityOf} from './categories';

export type EventDot = {
	key: string;
	// The event this dot stands for. null on the bucketed fallback, whose dot
	// stands for a slot rather than one event.
	id: string | null;
	t: number;
	// null on a per-event dot, where the dot *is* the event. Set only on the
	// bucketed fallback, whose dot stands for a slot that may hold several.
	count: number | null;
	// The event's own description on a per-event dot, null on the fallback.
	label: string | null;
	// null on the fallback, whose bucket mixes categories with no way to tell
	// them apart. Drawn in the plain Board accent there.
	category: EventCategory | null;
	// Resolved here rather than by the renderer, which would otherwise need to
	// know which of the three colour rules applies.
	color: string;
	// What the dot is coloured by under the current view, for its hint.
	identity: GuiEventIdentity | null;
	size: number;
	opacity: number;
};

// What a dot says when hovered. The identity is appended only where the label
// does not already carry it: "Tagged with bug" names its tag, "Commented" does
// not name its author.
export const dotDetail = (dot: EventDot): string => {
	const base =
		dot.label ?? `${dot.count ?? 0} board event${dot.count === 1 ? '' : 's'}`;

	return dot.identity && !base.includes(dot.identity.name)
		? `${base} — ${dot.identity.name}`
		: base;
};

// Fixed, because a per-event dot has no count to encode. Matches the commit
// scatter, which has always been one dot per commit.
const EVENT_DOT_SIZE = 4;
const EVENT_DOT_OPACITY = 0.55;

// The scatter plots each dot at its own timestamp, so it wants events, not
// buckets. Buckets are the fallback for a window the server capped, and only
// there do size and opacity carry a count.
// An event is drawn when its kind matches the view and the identity it would be
// coloured by has not been unticked. An event with no identity under this view
// always shows: there is nothing in the list for the user to have hidden it by.
// The rule the chart draws by, exported so the log can draw by the same one
// rather than growing a second copy to drift from it.
export const isShown = (
	entry: GuiEventTimelineEntry,
	view: BoardView,
	hiddenIds: ReadonlySet<string>,
	issueOnly: string | null = null,
): boolean => {
	// Board- and swimlane-level events carry no issue, so narrowing to one
	// ticket drops them too: they are not what happened to it.
	if (issueOnly !== null && entry.issue !== issueOnly) return false;

	if (view !== 'all' && categoryOf(entry.action) !== view) return false;

	const identity = identityOf(entry, view);

	return identity === null || !hiddenIds.has(identity.id);
};

export const buildEventDots = (
	timeline: GuiEventTimeline | null,
	view: BoardView = 'all',
	hiddenIds: ReadonlySet<string> = new Set(),
	issueOnly: string | null = null,
): EventDot[] => {
	if (!timeline) return [];

	if (timeline.events.length > 0) {
		return timeline.events.flatMap((entry, index) => {
			if (!isShown(entry, view, hiddenIds, issueOnly)) return [];

			const category = categoryOf(entry.action);
			const identity = identityOf(entry, view);

			return [
				{
					// Two events can share a millisecond, so time alone is not a key.
					key: `${entry.t}-${index}`,
					id: entry.id,
					t: entry.t,
					count: null,
					label: entry.label,
					category,
					color:
						view === 'all'
							? EVENT_CATEGORY_COLORS[category]
							: identity?.color ?? GUI_THEME.accent,
					identity,
					size: EVENT_DOT_SIZE,
					opacity: EVENT_DOT_OPACITY,
				},
			];
		});
	}

	const maxCount = maxOf(
		timeline.buckets.map(bucket => bucket.count),
		1,
	);

	return timeline.buckets.map(bucket => {
		const intensity = bucket.count / maxCount;

		return {
			key: String(bucket.t),
			id: null,
			t: bucket.t,
			count: bucket.count,
			label: null,
			category: null,
			color: GUI_THEME.accent,
			identity: null,
			size: 3 + intensity * 6,
			opacity: 0.3 + intensity * 0.5,
		};
	});
};
