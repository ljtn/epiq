import React from 'react';
import {GUI_THEME} from './gui-theme';

// One of a row of mutually exclusive choices, underlined rather than filled.
export const segmentedButtonStyle = (active: boolean): React.CSSProperties => ({
	background: 'transparent',
	border: 'none',
	borderBottom: `1px solid ${active ? GUI_THEME.accent : 'transparent'}`,
	color: active ? GUI_THEME.primary : GUI_THEME.dim,
	borderRadius: 0,
	fontSize: 11,
	padding: '2px 6px 3px',
	cursor: 'pointer',
});

// A well a few icon toggles sit in as one fixture; the pressed one keeps its
// lit ground. The gap is sized to read as a pair.
export const fixtureWellStyle: React.CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: 2,
	padding: 1,
	borderRadius: 6,
	background: GUI_THEME.panel2,
	// Longhand: the transport's well turns its colour off, and React warns on a
	// shorthand meeting a longhand.
	borderWidth: 1,
	borderStyle: 'solid',
	borderColor: GUI_THEME.line,
};
