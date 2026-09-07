import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

type Props = {
	label: React.ReactNode;
	checked: boolean;
	onChange: (next: boolean) => void;
	// Ticked for some of what it stands for rather than all — a parent over a
	// half-ticked list. Drawn as a bar, and reported to assistive technology as
	// `aria-checked="mixed"`, which is what the tick cannot say on its own.
	// Ignored while `checked`, which is the stronger statement of the two.
	mixed?: boolean;
	// Colour when checked. Defaults to the accent.
	activeColor?: string;
	disabled?: boolean;
	title?: string;
};

// Drawn to match the buttons rather than the platform's own. The native input
// is kept for semantics and keyboard behaviour, stretched invisibly over it.
export const Checkbox = ({
	label,
	checked,
	onChange,
	mixed,
	activeColor = GUI_THEME.accent,
	disabled,
	title,
}: Props) => {
	const partial = Boolean(mixed) && !checked;
	const color = checked || partial ? activeColor : GUI_THEME.dim;

	return (
		<label
			title={title}
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 5,
				fontSize: 10,
				color,
				cursor: disabled ? 'not-allowed' : 'pointer',
				opacity: disabled ? 0.4 : 1,
				// A label that wraps takes the row's height with it.
				whiteSpace: 'nowrap',
				flexShrink: 0,
			}}
		>
			<span
				style={{
					position: 'relative',
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: 12,
					height: 12,
					// Smaller than the buttons' 6px: at 12px square, 6 rounds to a circle.
					borderRadius: 4,
					border: `1px solid ${color}`,
					background: 'transparent',
					flexShrink: 0,
				}}
			>
				<input
					type="checkbox"
					checked={checked}
					aria-checked={partial ? 'mixed' : checked}
					disabled={disabled}
					onChange={event => onChange(event.target.checked)}
					style={{
						position: 'absolute',
						inset: 0,
						width: '100%',
						height: '100%',
						margin: 0,
						opacity: 0,
						cursor: 'inherit',
					}}
				/>
				{(checked || partial) && (
					<span
						style={{
							// A bar rather than the square: "some of this" has to be
							// tellable from "all of it" at a glance, at 12px.
							width: 6,
							height: partial ? 2 : 6,
							borderRadius: 1,
							background: activeColor,
						}}
					/>
				)}
			</span>
			{label}
		</label>
	);
};
