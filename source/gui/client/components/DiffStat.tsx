import {GUI_THEME} from '../lib/gui-theme';
import {CODE_FONT} from '../lib/code-text.style';
import {DIFF_STAT_METRICS, DiffStatVariant} from '../lib/diff-stat.style';
import {DiffBar} from './DiffBar';

export const DiffStat = ({
	insertions,
	deletions,
	bar = true,
	variant = 'stat',
	lit = false,
	title,
	testId,
}: {
	insertions: number;
	deletions: number;
	// The pill after the figures. Off where the figures are enough — a log
	// line has no room for a picture of what its two numbers already say.
	bar?: boolean;
	// `card` is the board's size: the ref's own type, and a hairline bar.
	variant?: DiffStatVariant;
	// This one is in focus — the card it sits on is the selected one — so it
	// comes up to full strength. Nothing on a variant that is already there.
	lit?: boolean;
	title?: string;
	testId?: string;
}) => {
	if (insertions + deletions === 0) return null;

	const metrics = DIFF_STAT_METRICS[variant];

	return (
		<div
			data-testid={testId}
			title={title}
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: metrics.gap,
				opacity: lit ? 1 : metrics.opacity,
				// Matches the ref beside it, which fades its own colour by the same
				// clock when it is hovered or copied.
				transition: 'opacity 120ms ease',
				flexShrink: 0,
				fontFamily: CODE_FONT,
				fontSize: metrics.fontSize,
			}}
		>
			<span style={{color: GUI_THEME.green}}>+{insertions}</span>
			<span style={{color: GUI_THEME.red}}>-{deletions}</span>
			{bar && (
				<DiffBar
					insertions={insertions}
					deletions={deletions}
					width={metrics.barWidth}
					height={metrics.barHeight}
				/>
			)}
		</div>
	);
};
