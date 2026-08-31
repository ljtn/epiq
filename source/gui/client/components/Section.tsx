import React from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

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
			// 14 rather than 20: the panel stacks six of these, so the padding
			// was costing more than a ticket card's worth of height in total.
			padding: first ? '0px 0 14px 0' : '14px 0',
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
					fontSize: TEXT.label,
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
