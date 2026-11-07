// The inspector shows one subject at a time. Several can be open at once (a
// lane panel left open under a ticket, say): the first in this order wins.

export type InspectorPanel =
	| 'none'
	| 'diff'
	| 'lane'
	| 'board'
	| 'goal'
	| 'bulk'
	| 'issue';

export type InspectorSubjects = {
	// A film closes every panel; the subjects stay open underneath.
	playing: boolean;
	commitDiff: boolean;
	lane: boolean;
	boardDetails: boolean;
	// The board's panel needs a board on screen, and holds its place without one.
	boardOnScreen: boolean;
	goal: boolean;
	pickedCount: number;
	issue: boolean;
};

export const inspectorPanel = (open: InspectorSubjects): InspectorPanel => {
	if (open.playing) return 'none';
	if (open.commitDiff) return 'diff';
	if (open.lane) return 'lane';
	if (open.boardDetails) return open.boardOnScreen ? 'board' : 'none';
	if (open.goal) return 'goal';
	if (open.pickedCount > 1) return 'bulk';
	if (open.issue) return 'issue';
	return 'none';
};
