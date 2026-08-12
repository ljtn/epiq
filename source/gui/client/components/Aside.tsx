import React, {forwardRef} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const ASIDE_WIDTH = 440;

export const Aside = forwardRef<HTMLElement, {children: React.ReactNode}>(
	({children}, ref) => (
		<aside
			ref={ref}
			style={{
				boxSizing: 'border-box',
				width: ASIDE_WIDTH,
				minWidth: ASIDE_WIDTH,
				borderLeft: `1px solid ${GUI_THEME.line}`,
				background: GUI_THEME.panel,
				padding: 20,
				fontSize: 12,
				overflow: 'auto',
			}}
		>
			{children}
		</aside>
	),
);

Aside.displayName = 'Aside';
