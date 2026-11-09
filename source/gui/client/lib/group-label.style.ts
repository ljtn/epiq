import React from 'react';
import {GUI_THEME, SANS_FONT} from './gui-theme';

// The small capitals naming a group of controls, as the toolbar's and the
// goal strip's are.
export const GROUP_LABEL_STYLE: React.CSSProperties = {
	fontFamily: SANS_FONT,
	fontSize: 8,
	lineHeight: 1,
	letterSpacing: '0.1em',
	textTransform: 'uppercase',
	whiteSpace: 'nowrap',
	userSelect: 'none',
};

// The label's resting colour, before any glow lights it.
export const GROUP_LABEL_COLOR = GUI_THEME.dim;
export const GROUP_LABEL_OPACITY = 0.6;
