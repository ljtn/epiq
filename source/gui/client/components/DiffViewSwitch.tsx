import {segmentedButtonStyle} from '../lib/segmented.style';

// Which shape the Code tab draws the ticket's change in: all of it at once,
// or the commits that made it.
//
// Two views of one thing rather than two tabs, because they answer the same
// question at different grain — how did this happen, and what did it come to.
export const DiffViewSwitch = ({
	compacted,
	onChange,
	// How many commits its own segment leads to. On the switch rather than
	// inside the view, so the length of the list is legible from the segment
	// the reader is not on — which is what that view is for, now that it lists
	// rather than opens them (3RQ4QG4).
	//
	// No pair on `Diff`: the count there would be changed files, which only the
	// compacted diff knows, and that is fetched when its view is opened rather
	// than with the ticket. A number that appears once the reader is already
	// looking is not one that helped them decide to look.
	//
	// Undefined while the commits are still being fetched: a count is a fact,
	// and `(0)` on a ticket that has commits is a wrong one.
	commitCount,
	// A deep link names a commit and a line inside it, which only the
	// per-commit view can show. The choice is held rather than taken away, so
	// leaving the link puts the reader back where they were.
	pinnedToCommits = false,
}: {
	compacted: boolean;
	onChange: (next: boolean) => void;
	commitCount?: number;
	pinnedToCommits?: boolean;
}) => (
	<div
		data-testid="diff-view-switch"
		style={{display: 'flex', gap: 2, marginBottom: 10}}
	>
		{/* Both segments go flat while a deep link holds the view: the reader is
		    on the commits because the link points into one, and pressing the
		    segment they are already on must not quietly overwrite the choice
		    this switch remembers for them. */}
		{/* Flat first: it is the whole change at once, and the commits are how
		    it got there. */}
		<button
			aria-pressed={compacted}
			disabled={pinnedToCommits}
			title={
				pinnedToCommits
					? 'Following a link into a commit — clear it to flatten'
					: 'Every commit as one diff'
			}
			onClick={() => onChange(true)}
			style={{
				...segmentedButtonStyle(compacted),
				...(pinnedToCommits ? {opacity: 0.35, cursor: 'default'} : {}),
			}}
		>
			Diff
		</button>
		<button
			aria-pressed={!compacted}
			disabled={pinnedToCommits}
			title={
				pinnedToCommits
					? 'Following a link into a commit'
					: 'Each commit and the files it changed'
			}
			onClick={() => onChange(false)}
			style={{
				...segmentedButtonStyle(!compacted),
				...(pinnedToCommits ? {cursor: 'default'} : {}),
			}}
		>
			{commitCount === undefined ? 'Commits' : `Commits (${commitCount})`}
		</button>
	</div>
);
