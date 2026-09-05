import React from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

// A rounded pill rather than GitHub's five solid squares — matches the
// rest of the app's soft, rounded chrome instead of copying its exact look.
export const DiffStat = ({
	insertions,
	deletions,
}: {
	insertions: number;
	deletions: number;
}) => {
	const total = insertions + deletions;
	if (total === 0) return null;

	const addRatio = insertions / total;

	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 6,
				flexShrink: 0,
				fontFamily: 'ui-monospace, monospace',
				fontSize: TEXT.meta,
			}}
		>
			<span style={{color: GUI_THEME.green}}>+{insertions}</span>
			<span style={{color: GUI_THEME.red}}>-{deletions}</span>
			<div
				style={{
					width: 32,
					height: 3,
					borderRadius: 1.5,
					overflow: 'hidden',
					display: 'flex',
					background: GUI_THEME.line,
				}}
			>
				<div
					style={{width: `${addRatio * 100}%`, background: GUI_THEME.green}}
				/>
				<div
					style={{
						width: `${(1 - addRatio) * 100}%`,
						background: GUI_THEME.red,
					}}
				/>
			</div>
		</div>
	);
};
