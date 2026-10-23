import {GUI_THEME} from '../lib/gui-theme';

const MIN_FILL_PX = 2;

// The picture two figures make: how much of a change was added and how much
// taken away, as one rounded pill — GitHub's five squares at the app's own
// softer weight. Sized by its caller, since the same pill is a bar beside a
// commit and a hairline on a board card.
export const DiffBar = ({
	insertions,
	deletions,
	width,
	height,
	fill = 1,
}: {
	insertions: number;
	deletions: number;
	width: number;
	height: number;
	// How much of the pill's length the change takes, 0 to 1: how big a change
	// is, where the slot is one length on every row. The rest is left empty
	// rather than drawn as a track, which would read as progress towards done.
	// Never under two pixels, so the smallest change still shows.
	fill?: number;
}) => {
	const total = insertions + deletions;
	if (total === 0) return null;

	const addRatio = insertions / total;
	const filled = Math.max(MIN_FILL_PX, fill * width);

	return (
		<div
			style={{
				width,
				height,
				borderRadius: height / 2,
				overflow: 'hidden',
				display: 'flex',
				flexShrink: 0,
				background: fill < 1 ? 'transparent' : GUI_THEME.line,
			}}
		>
			{/* Rounded itself, so a short fill ends as the full pill does. */}
			<div
				style={{
					width: filled,
					display: 'flex',
					flexShrink: 0,
					borderRadius: height / 2,
					overflow: 'hidden',
				}}
			>
				<div
					style={{width: `${addRatio * 100}%`, background: GUI_THEME.green}}
				/>
				<div
					style={{
						width: `${(1 - addRatio) * 100}%`,
						background: GUI_THEME.red,
					}}
				/>
			</div>
		</div>
	);
};
