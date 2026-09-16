import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {CODE_FONT} from '../lib/code-text.style';
import {DIFF_STAT_BAR_WIDTH, DIFF_STAT_GAP} from '../lib/diff-stat.style';

// A rounded pill rather than GitHub's five solid squares — matches the
// rest of the app's soft, rounded chrome instead of copying its exact look.
export const DiffStat = ({
	insertions,
	deletions,
	bar = true,
}: {
	insertions: number;
	deletions: number;
	// The pill after the figures. Off where the figures are enough — a log
	// line has no room for a picture of what its two numbers already say.
	bar?: boolean;
}) => {
	const total = insertions + deletions;
	if (total === 0) return null;

	const addRatio = insertions / total;

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: DIFF_STAT_GAP,
				flexShrink: 0,
				fontFamily: CODE_FONT,
				fontSize: TEXT.meta,
			}}
		>
			<span style={{color: GUI_THEME.green}}>+{insertions}</span>
			<span style={{color: GUI_THEME.red}}>-{deletions}</span>
			{bar && (
				<div
					style={{
						width: DIFF_STAT_BAR_WIDTH,
						height: 3,
						borderRadius: 1.5,
						overflow: 'hidden',
						display: 'flex',
						background: GUI_THEME.line,
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
			)}
		</div>
	);
};
