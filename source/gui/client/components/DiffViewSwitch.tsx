import {segmentedButtonStyle} from '../lib/segmented.style';

// Which shape the Diff tab draws the ticket's change in: the commits that made
// it, or all of them at once.
//
// Two views of one thing rather than two tabs, because they answer the same
// question at different grain — how did this happen, and what did it come to.
export const DiffViewSwitch = ({
	compacted,
	onChange,
	// A deep link names a commit and a line inside it, which only the
	// per-commit view can show. The choice is held rather than taken away, so
	// leaving the link puts the reader back where they were.
	pinnedToCommits = false,
}: {
	compacted: boolean;
	onChange: (next: boolean) => void;
	pinnedToCommits?: boolean;
}) => (
	<div
		data-testid="diff-view-switch"
		style={{display: 'flex', gap: 2, marginBottom: 10}}
	>
		<button
			aria-pressed={!compacted}
			title="Each commit and the files it changed"
			onClick={() => onChange(false)}
			style={segmentedButtonStyle(!compacted)}
		>
			Commits
		</button>
		<button
			aria-pressed={compacted}
			disabled={pinnedToCommits}
			title={
				pinnedToCommits
					? 'Following a link into a commit — clear it to compact'
					: 'Every commit as one diff'
			}
			onClick={() => onChange(true)}
			style={{
				...segmentedButtonStyle(compacted),
				...(pinnedToCommits ? {opacity: 0.35, cursor: 'default'} : {}),
			}}
		>
			Compacted
		</button>
	</div>
);
