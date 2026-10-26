import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

// An on/off setting drawn as a switch; `Checkbox` is for picking from a set.
// On: an accent-washed track and accent knob. Off: a recessed track, dim knob.

// Border-box; the knob sits `gap` in from the padding box on every side.
// Small fits a toolbar row.
const SIZES = {
	regular: {width: 28, height: 16, knob: 10, gap: 2},
	small: {width: 22, height: 12, knob: 8, gap: 1},
} as const;
const BORDER = 1;

// Three steps of the active colour, as the tag chips take washes of theirs:
// the track at a quarter, the label at half, the knob at full.
const WASH = '40';
const LABEL = '80';

export const Switch = ({
	label,
	checked,
	onChange,
	activeColor = GUI_THEME.accent,
	disabled,
	title,
	either = false,
	size = 'regular',
	// TooltipLayer strips `title` while open, so tests find this by test id.
	testId,
}: {
	label?: React.ReactNode;
	checked: boolean;
	onChange: (next: boolean) => void;
	activeColor?: string;
	disabled?: boolean;
	title?: string;
	testId?: string;
	// A choice between two things rather than on or off: lit at both ends,
	// the knob's side saying which.
	either?: boolean;
	size?: keyof typeof SIZES;
}) => {
	const lit = checked || either;
	const {width, height, knob, gap} = SIZES[size];
	const travel = width - 2 * BORDER - knob - gap;

	return (
		<label
			title={title}
			data-testid={testId}
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 8,
				fontSize: 11,
				color: lit ? `${activeColor}${LABEL}` : GUI_THEME.dim,
				cursor: disabled ? 'not-allowed' : 'pointer',
				opacity: disabled ? 0.4 : 1,
				whiteSpace: 'nowrap',
				flexShrink: 0,
			}}
		>
			<span
				style={{
					position: 'relative',
					display: 'inline-block',
					width,
					height,
					borderRadius: 999,
					// Washed when on; the panel's recess when off.
					background: lit ? `${activeColor}${WASH}` : GUI_THEME.panel,
					// `dim`, not `line`, which all but vanishes against a card.
					border: `${BORDER}px solid ${
						lit ? `${activeColor}${WASH}` : GUI_THEME.dim
					}`,
					boxSizing: 'border-box',
					flexShrink: 0,
					transition: 'background 120ms ease, border-color 120ms ease',
				}}
			>
				<input
					type="checkbox"
					role="switch"
					checked={checked}
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
				<span
					aria-hidden
					style={{
						position: 'absolute',
						// Relative to the padding box, which already starts inside the
						// border — so `gap` here is the gap you see.
						top: gap,
						left: checked ? travel : gap,
						width: knob,
						height: knob,
						borderRadius: 999,
						// The knob carries the dim when off.
						background: lit ? activeColor : GUI_THEME.dim,
						transition: 'left 120ms ease, background 120ms ease',
						pointerEvents: 'none',
					}}
				/>
			</span>
			{label}
		</label>
	);
};
