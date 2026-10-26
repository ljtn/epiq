// A panel's drag edge: a wide invisible hit area round a thin indicator, lit
// while hovered or dragging.

import {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const ResizeHandle = ({
	edge,
	active,
	onPointerDown,
	testId,
}: {
	// Which edge of the panel this sits on.
	edge: 'left' | 'right' | 'top';
	// A drag is in progress, which keeps the indicator lit while the pointer
	// is off the handle.
	active: boolean;
	onPointerDown: (event: React.PointerEvent) => void;
	testId?: string;
}) => {
	const [hovered, setHovered] = useState(false);
	const alongTheTop = edge === 'top';

	return (
		<div
			data-testid={testId}
			onPointerDown={onPointerDown}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			aria-label="Drag to resize"
			style={{
				position: 'absolute',
				zIndex: 1,
				display: 'flex',
				...(alongTheTop
					? {
							top: 0,
							left: 0,
							right: 0,
							height: 12,
							marginTop: -6,
							cursor: 'ns-resize',
							alignItems: 'center',
					  }
					: {
							[edge]: 0,
							top: 0,
							bottom: 0,
							width: 12,
							[edge === 'left' ? 'marginLeft' : 'marginRight']: -6,
							cursor: 'ew-resize',
							justifyContent: 'center',
					  }),
			}}
		>
			<div
				style={{
					...(alongTheTop
						? {height: 2, width: '100%'}
						: {width: 2, alignSelf: 'stretch'}),
					background: hovered || active ? GUI_THEME.accent : 'transparent',
					transition: 'background 120ms ease',
				}}
			/>
		</div>
	);
};
