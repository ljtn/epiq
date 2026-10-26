import {useDiffWrap} from '../lib/diff-wrap';
import {fixtureWellStyle, segmentedButtonStyle} from '../lib/segmented.style';
import {IconScrollLines} from './IconScrollLines';
import {IconWrapLines} from './IconWrapLines';
import {IconButton, ICON_SIZE} from './IconButton';

// Whether the Code tab draws the ticket's change at once or by commit.
export const DiffViewSwitch = ({
	compacted,
	onChange,
	// Shown on the Commits segment; undefined while still fetching.
	commitCount,
	// A deep link into a commit holds the per-commit view without changing the
	// remembered choice.
	pinnedToCommits = false,
}: {
	compacted: boolean;
	onChange: (next: boolean) => void;
	commitCount?: number;
	pinnedToCommits?: boolean;
}) => {
	const [wrap, setWrap] = useDiffWrap();

	return (
		<div
			data-testid="diff-view-switch"
			style={{display: 'flex', gap: 2, marginBottom: 10}}
		>
			{/* Both segments go flat while a deep link holds the view. */}
			{/* Flat first: it is the whole change at once, and the commits are how
			    it got there. */}
			<button
				data-testid="diff-view-flat"
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
			{/* Named so tests can tell it from the chart's commit select. */}
			<button
				data-testid="diff-view-commits"
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
			{/* Apart from the two views, at the far end: it changes how either is
			    drawn, not which one is shown. */}
			<div
				data-testid="diff-wrap"
				style={{...fixtureWellStyle, marginLeft: 'auto'}}
			>
				<IconButton
					title="Long lines scroll sideways"
					aria-label="Scroll long lines"
					pressed={!wrap}
					onClick={() => setWrap(false)}
				>
					<IconScrollLines size={ICON_SIZE} />
				</IconButton>
				<IconButton
					title="Long lines wrap"
					aria-label="Wrap long lines"
					pressed={wrap}
					onClick={() => setWrap(true)}
				>
					<IconWrapLines size={ICON_SIZE} />
				</IconButton>
			</div>
		</div>
	);
};
