import {GUI_THEME} from '../lib/gui-theme';

// The picture two figures make: how much of a change was added and how much
// taken away, as one rounded pill — GitHub's five squares at the app's own
// softer weight. Sized by its caller, since the same pill is a bar beside a
// commit and a hairline on a board card.
export const DiffBar = ({
	insertions,
	deletions,
	width,
	height,
}: {
	insertions: number;
	deletions: number;
	width: number;
	height: number;
}) => {
	const total = insertions + deletions;
	if (total === 0) return null;

	const addRatio = insertions / total;

	return (
		<div
			style={{
				width,
				height,
				borderRadius: height / 2,
				overflow: 'hidden',
				display: 'flex',
				flexShrink: 0,
				background: GUI_THEME.line,
			}}
		>
			<div style={{width: `${addRatio * 100}%`, background: GUI_THEME.green}} />
			<div
				style={{width: `${(1 - addRatio) * 100}%`, background: GUI_THEME.red}}
			/>
		</div>
	);
};
