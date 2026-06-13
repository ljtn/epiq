import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const Aside = ({children}: {children: React.ReactNode}) => (
	<aside
		style={{
			width: 380,
			minWidth: 380,
			borderLeft: `1px solid ${GUI_THEME.line}`,
			background: GUI_THEME.panel,
			padding: 18,
			fontSize: 12,
			overflow: 'auto',
		}}
	>
		{children}
	</aside>
);
