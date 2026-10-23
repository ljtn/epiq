import React, {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {useFocusLift} from '../lib/use-focus-lift';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	// `primary` is the next step — what commits a form, one per decision — and
	// is lit in the accent so it is found before the rest. `ghost` is what
	// dismisses it, and what inline controls in a header or a card row take.
	// Everything else is `default`.
	variant?: 'default' | 'ghost' | 'chip' | 'primary';
	// A primary step that destroys: lit in red rather than the accent.
	danger?: boolean;
	// A name that survives the pointer, as `IconButton` has. TooltipLayer takes
	// `title` off whatever it describes while its tooltip is open, so a button
	// found by its title is unfindable for as long as somebody rests on it.
	testId?: string;
	// A hex colour the button *stands for*, rather than one it is painted in: a
	// tag's own colour. The fill and the border take a wash of it, so the name,
	// what it sits on and what encloses it read as one object instead of three.
	// Kept far enough down that it colours the chip without competing with the
	// title above it.
	tint?: string;
	// This one is on and stays on — the tag the board is narrowed to. A step
	// past what the pointer does, so it reads as pressed across a board the
	// pointer is nowhere near, and pressing it again is visibly the way back.
	// Only means anything alongside a `tint`.
	held?: boolean;
	// The same chip, tightened. A panel shows a ticket's tags once and has the
	// room; a card shows them in a column of thirty, where the row of tags is
	// the card's height and every step of padding is paid for down the board.
	dense?: boolean;
};

// Forwards its ref: a modal that opens on one of its buttons has to focus it.
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			children,
			variant = 'default',
			tint,
			held = false,
			dense = false,
			danger = false,
			style,
			onMouseEnter,
			onMouseLeave,
			onFocus,
			onBlur,
			testId,
			...props
		},
		ref,
	) => {
		const [pointed, setPointed] = useState(false);
		const {focused, focusProps} = useFocusLift<HTMLButtonElement>({
			onFocus,
			onBlur,
		});
		const lifted = pointed || focused;

		const isPrimary = variant === 'primary';
		// Unlit while it cannot be taken: a step that is not available yet is
		// not the next one.
		const lit = isPrimary && !props.disabled;
		const hue = danger ? GUI_THEME.red : GUI_THEME.accent;

		// Four steps of the same wash: resting, under the pointer, held, and held
		// under the pointer. The border climbs faster than the fill — it is the edge
		// that says which chip you are on, while the fill stays behind the name.
		const wash = held ? (lifted ? '4d' : '3d') : lifted ? '2b' : '1c';
		const edge = held ? 'ff' : lifted ? '7a' : '3d';

		return (
			<button
				ref={ref}
				data-testid={testId}
				{...props}
				onMouseEnter={event => {
					setPointed(true);
					onMouseEnter?.(event);
				}}
				onMouseLeave={event => {
					setPointed(false);
					onMouseLeave?.(event);
				}}
				{...focusProps}
				style={{
					appearance: 'none',
					WebkitAppearance: 'none',
					background: tint
						? `${tint}${wash}`
						: lit
						? `${hue}${lifted ? '33' : '1f'}`
						: isPrimary
						? GUI_THEME.raised
						: variant === 'chip'
						? // Its own dark ground, so its edge still shows on a row lit under it.
						  lifted
							? `linear-gradient(${GUI_THEME.hover}, ${GUI_THEME.hover}), ${GUI_THEME.panel}`
							: GUI_THEME.panel
						: lifted
						? GUI_THEME.hover
						: 'transparent',
					color: lit ? hue : GUI_THEME.secondary,
					border: tint
						? `1px solid ${tint}${edge}`
						: isPrimary
						? `none`
						: variant === 'ghost' && !lifted
						? '1px solid transparent'
						: `1px solid ${lifted ? GUI_THEME.secondary : GUI_THEME.line}`,
					borderRadius: variant === 'chip' ? 999 : 6,
					cursor: props.disabled ? 'default' : 'pointer',
					// One box for every variant that draws one, so a row mixing them
					// reads as one set of controls rather than three.
					padding: dense
						? '2px 8px'
						: variant === 'ghost'
						? '3px 6px'
						: '5px 9px',
					fontFamily: 'inherit',
					fontSize: dense ? 11 : 12,
					// One weight for every button in a row. `primary` already has a body
					// where the others have an outline or nothing, and that is the whole
					// difference — setting it in bold as well said the same thing twice,
					// and at 12px read as shouting next to the two beside it.
					fontWeight: 400,
					lineHeight: 1,
					transition:
						'color 120ms ease, background 120ms ease, border-color 120ms ease',
					outline: 'none',
					opacity: props.disabled ? 0.7 : 1,
					...style,
				}}
			>
				{children}
			</button>
		);
	},
);

Button.displayName = 'Button';
