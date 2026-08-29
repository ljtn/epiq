import React, {forwardRef} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const ASIDE_WIDTH = 440;

// Diff mode's split (before/after) layout needs roughly double the room a
// single-column panel does.
export const ASIDE_DIFF_WIDTH = ASIDE_WIDTH * 2;

export const Aside = forwardRef<
	HTMLElement,
	{children: React.ReactNode; width?: number}
>(({children, width = ASIDE_WIDTH}, ref) => (
	<aside
		ref={ref}
		style={{
			boxSizing: 'border-box',
			width,
			minWidth: width,
			borderLeft: `1px solid ${GUI_THEME.line}`,
			background: GUI_THEME.panel,
			padding: 20,
			fontSize: 12,
			overflow: 'auto',
		}}
	>
		{children}
	</aside>
));

Aside.displayName = 'Aside';
