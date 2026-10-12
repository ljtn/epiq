import {CSSProperties} from 'react';
import {CARD} from './card.style';
import {GUI_THEME} from './gui-theme';

/**
 * A comment card, wherever it appears: the Comments lane and the annotation a
 * comment gets inside a diff. The two are meant to read as one thing, so the
 * card lives here rather than being spelled out in both. The panels' card,
 * and nothing more: somebody's writing is marked by the name over it, not by
 * a bar beside it.
 *
 * The horizontal padding is the wider half of the pair: in the lanes view the
 * comments column is the narrowest one, and text set hard against the border
 * was the first thing to look cramped.
 */
export const COMMENT_CARD_STYLE: CSSProperties = {
	...CARD,
	padding: '12px 14px',
};

/**
 * The one comment a link points at — arrived at from a log line about it, or
 * from a permalink. The same wash the event log lays under the line it is
 * following, so the line and what it leads to read as one thing.
 */
export const COMMENT_CARD_FOCUSED_STYLE: CSSProperties = {
	...COMMENT_CARD_STYLE,
	border: `1px solid ${GUI_THEME.accent}`,
	background: `linear-gradient(${GUI_THEME.accentWash}, ${GUI_THEME.accentWash}), ${GUI_THEME.panel2}`,
};
