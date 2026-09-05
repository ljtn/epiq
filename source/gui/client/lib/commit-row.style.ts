import React from 'react';
import {GUI_THEME, TEXT} from './gui-theme';

// The timeline rail: a dot per commit, in the scrubber's own commit-series
// color, connected to the next by a line. RAIL_DOT_OFFSET lines the dot up
// with the header's text — the card's border, then the header's padding,
// then half its content height (the copy button, its tallest child, at 20px,
// with the subject centred against it) — not the row's overall height, which
// grows when a commit is expanded.
export const RAIL_WIDTH = 24;
export const COMMIT_HEADER_PADDING = 13;
export const RAIL_DOT_OFFSET = 1 + COMMIT_HEADER_PADDING + 10;
export const ROW_GAP = 14;

export const disclosureStyle: React.CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	gap: 8,
	width: '100%',
	textAlign: 'left',
	background: 'transparent',
	border: 'none',
	borderRadius: 6,
	cursor: 'pointer',
	color: GUI_THEME.primary,
	font: 'inherit',
	fontSize: TEXT.ui,
	transition: 'background 120ms ease',
};

// Says "this opens" before it is clicked.
export const DISCLOSURE_HOVER_BG = 'rgba(255,255,255,0.04)';
