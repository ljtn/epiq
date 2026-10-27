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
}: {
	compacted: boolean;
	onChange: (next: boolean) => void;
	commitCount?: number;
}) => {
	const [wrap, setWrap] = useDiffWrap();

	return (
		<div
			data-testid="diff-view-switch"
			style={{display: 'flex', gap: 2, marginBottom: 10}}
		>
			{/* Flat first: it is the whole change at once, and the commits are how
			    it got there. */}
			<button
				data-testid="diff-view-flat"
				aria-pressed={compacted}
				title="Every commit as one diff"
				onClick={() => onChange(true)}
				style={segmentedButtonStyle(compacted)}
			>
				Diff
			</button>
			{/* Named so tests can tell it from the chart's commit select. */}
			<button
				data-testid="diff-view-commits"
				aria-pressed={!compacted}
				title="Each commit and the files it changed"
				onClick={() => onChange(false)}
				style={segmentedButtonStyle(!compacted)}
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
