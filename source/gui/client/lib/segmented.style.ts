import React from 'react';
import {GUI_THEME} from './gui-theme';

// One of a row of mutually exclusive choices — the scrubber's period, the Diff
// tab's commits-or-compacted. Underlined rather than filled, so a row of them
// reads as a set of options with one taken, not a row of buttons one of which
// happens to be lit.
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

// A well a few icon toggles sit in as one fixture: the scrubber's panel
// toggles and transport, the Code tab's scroll-or-wrap. The pressed one keeps
// its lit ground; the others light on hover.
//
// The gap is a sliver of the well's own ground, for a pair of switches in one
// fixture rather than one control with two halves: at a pixel the rounded
// grounds swallow it, past two it stops reading as a pair.
export const fixtureWellStyle: React.CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	gap: 2,
	padding: 1,
	borderRadius: 6,
	background: GUI_THEME.panel2,
	// Longhand, because the transport's well turns its colour off and React
	// warns — rightly — about a shorthand and a longhand for the same value
	// meeting on a rerender.
	borderWidth: 1,
	borderStyle: 'solid',
	borderColor: GUI_THEME.line,
};
