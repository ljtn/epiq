import React from 'react';
import {GUI_THEME, TEXT} from './gui-theme';

// The timeline rail: a dot per commit joined by a line. RAIL_DOT_OFFSET
// centres the dot on the header's text, not the row, which grows when expanded.
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
