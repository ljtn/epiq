import {CSSProperties} from 'react';
import {CARD} from './card.style';
import {GUI_THEME} from './gui-theme';

/** A comment card, in the Comments lane and inside a diff alike. */
export const COMMENT_CARD_STYLE: CSSProperties = {
	...CARD,
	padding: '12px 14px',
};

/** The comment a link points at, under the event log's follow wash. */
export const COMMENT_CARD_FOCUSED_STYLE: CSSProperties = {
	...COMMENT_CARD_STYLE,
	border: `1px solid ${GUI_THEME.accent}`,
	background: `linear-gradient(${GUI_THEME.accentWash}, ${GUI_THEME.accentWash}), ${GUI_THEME.panel2}`,
};
