import {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

// Matches SwimlaneColumn's width
const COLUMN_WIDTH = 360;

export const AddSwimlaneColumn = ({onClick}: {onClick: () => void}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			data-testid="add-swimlane"
			title="Add swimlane"
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				appearance: 'none',
				WebkitAppearance: 'none',
				width: COLUMN_WIDTH,
				minWidth: COLUMN_WIDTH,
				height: '100%',
				boxSizing: 'border-box',
				border: `1px dashed ${hovered ? GUI_THEME.secondary : GUI_THEME.line}`,
				borderRadius: 12,
				background: hovered ? GUI_THEME.bgHighlight : 'transparent',
				color: hovered ? GUI_THEME.secondary : GUI_THEME.dim,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: 6,
				cursor: 'pointer',
				fontFamily: 'inherit',
				outline: 'none',
				transition:
					'color 120ms ease, border-color 120ms ease, background 120ms ease',
			}}
		>
			<span style={{fontSize: 20, lineHeight: 1}}>+</span>
			<span style={{fontSize: 12}}>new swimlane</span>
		</button>
	);
};
