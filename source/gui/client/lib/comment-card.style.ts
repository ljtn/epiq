import {CSSProperties} from 'react';
import {GUI_THEME} from './gui-theme';

/**
 * A comment card, wherever it appears: the Comments lane and the annotation a
 * comment gets inside a diff. The two are meant to read as one thing, so the
 * card lives here rather than being spelled out in both — the accent left edge
 * is what marks it as somebody's writing rather than the app's own chrome.
 *
 * The horizontal padding is the wider half of the pair: in the lanes view the
 * comments column is the narrowest one, and text set hard against the border
 * was the first thing to look cramped.
 */
export const COMMENT_CARD_STYLE: CSSProperties = {
	border: `1px solid ${GUI_THEME.line}`,
	borderLeft: `2px solid ${GUI_THEME.accent}`,
	borderRadius: 6,
	padding: '10px 14px',
	background: GUI_THEME.tertiary,
};
