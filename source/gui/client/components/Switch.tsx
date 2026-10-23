import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

// A setting that is on or off, drawn as the thing it is: a switch, whose
// position says the state before the label does.
//
// Distinct from `Checkbox`, which is for choosing items out of a set — a lane
// in the funnel, a file in a diff — and reads as a tick against a list. This
// is for a thing that is *running* or not, where the question is not "is this
// one included" but "is it on", and where the answer wants to be legible at a
// glance from across the panel.
//
// Epiq's own weights rather than the platform's: on, the track takes a wash of
// the accent and the knob the accent itself; off, the track is the panel's
// own recess and the knob is dim. A plain circle that slides, no shadow and
// no gradient — nothing else in this GUI has either, and a switch borrowed
// whole from somewhere else reads as a component from another application.
//
// A wash rather than the full accent: a filled track was the brightest thing
// on any panel it sat on, for a state that is only ever read in passing.

// Border-box, so the border is inside these. The knob sits its size's `gap` in from the
// padding box on every side, which is what makes its travel read as the same
// distance at each end.
// Small sits in a toolbar row, among 11px type and 24px icon buttons.
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
	// A name that survives the pointer. TooltipLayer takes `title` off whatever
	// it is describing while its tooltip is open, so a control found by its
	// title is unfindable for as long as somebody rests on it.
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
					// Washed when on; the panel's own recess when off, so an unset
					// switch reads as a slot with nothing in it rather than as a
					// second colour.
					background: lit ? `${activeColor}${WASH}` : GUI_THEME.panel,
					// `dim` off, not `line`. `line` is a 15% wash meant for dividing
					// one surface — against the card it composites to about #191d28
					// and the track all but disappeared, leaving the knob floating
					// with nothing to say how far it could travel. A switch has to
					// show its whole extent to read as a switch at all.
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
						// On the washed track the knob is the one full-strength mark;
						// against the empty track it is the only mark, so it carries
						// the dim.
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
