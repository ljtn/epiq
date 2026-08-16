import {GuiCommitEntry, GuiEventTimeline} from './gui-state.model';

export type HistoryWindow = {
	// Identifies which window is on screen, so a view keyed off it animates once
	// the data it belongs to has landed rather than when it was asked for.
	requestId: number;
	timeline: GuiEventTimeline;
	commits: GuiCommitEntry[];
};

export type HistoryHalf = {
	timeline?: GuiEventTimeline;
	commits?: GuiCommitEntry[];
};

/**
 * Publishes the event timeline and commit log of one history window together,
 * since the scrubber derives its coordinate system from both at once. Pairing
 * is by request id, not by "both slots are full", or a reply from an abandoned
 * request gets filed against the current window's other half.
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
			// An id-less reply would otherwise match a closed buffer's `undefined`.
			if (requestId === undefined) return;
			if (requestId !== pending.requestId) return;

			pending = {...pending, ...half};

			const {timeline, commits} = pending;
			if (!timeline || !commits) return;

			// Dropping the id closes the buffer against duplicate and late replies.
			pending = {};
			publish({requestId, timeline, commits});
		},
	};
};
