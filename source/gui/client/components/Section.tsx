import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const Section = ({
	title,
	action,
	children,
	first = false,
}: {
	first?: boolean;
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) => (
	<section
		style={{
			padding: first ? '0px 0 20px 0' : '20px 0',
			borderTop: first ? 'none' : `1px solid ${GUI_THEME.line}`,
		}}
	>
		<div
			style={{
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'center',
				gap: 12,
			}}
		>
			<span
				style={{
					color: GUI_THEME.secondary,
					fontSize: 10,
					textTransform: 'uppercase',
					letterSpacing: '0.08em',
				}}
			>
				{title}
			</span>

			{action}
		</div>

		{children}
	</section>
);
