import {GuiCommitEntry, GuiEventTimeline} from './gui-state.model';

export type HistoryWindow = {
	timeline: GuiEventTimeline;
	commits: GuiCommitEntry[];
};

export type HistoryHalf = {
	timeline?: GuiEventTimeline;
	commits?: GuiCommitEntry[];
};

/**
 * Collects the two halves of one history window — the event timeline and the
 * commit log — and publishes them together.
 *
 * They are requested as a pair and rendered as a pair: the scrubber derives its
 * whole coordinate system (earliest, latest, span, bucket count, per-series
 * normalisation) from both at once, so applying one without the other shows a
 * chart drawn against a range it doesn't belong to.
 *
 * Pairing is by request id, not by "both slots are full". Clicking through the
 * scope buttons abandons requests whose replies are still in flight, and a
 * reply from an abandoned request would otherwise be filed next to a half of
 * the current one — rendering one window's events against another's commits,
 * and stranding the reply that was displaced.
 */
export const createHistoryBuffer = (
	publish: (window: HistoryWindow) => void,
) => {
	let lastRequestId = 0;
	let pending: {requestId?: number} & HistoryHalf = {};

	return {
		/** Starts a new window, abandoning whatever the previous one buffered. */
		open(): number {
			lastRequestId += 1;
			pending = {requestId: lastRequestId};
			return lastRequestId;
		},

		/** Files one half, ignoring replies to any request but the open one. */
		accept(requestId: number | undefined, half: HistoryHalf): void {
			// An id-less reply is never accepted: it cannot be attributed to a
			// request, and matching it against a closed buffer's `undefined`
			// would let it through.
			if (requestId === undefined) return;
			if (requestId !== pending.requestId) return;

			pending = {...pending, ...half};

			const {timeline, commits} = pending;
			if (!timeline || !commits) return;

			// Dropping the id closes the buffer, so a duplicate or late reply
			// can't re-open a window that has already been published.
			pending = {};
			publish({timeline, commits});
		},
	};
};
