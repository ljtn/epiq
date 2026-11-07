import React, {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {useFocusLift} from '../lib/use-focus-lift';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	// `primary` commits a form, one per decision; `ghost` dismisses it and suits
	// inline controls.
	variant?: 'default' | 'ghost' | 'chip' | 'primary';
	// A primary step that destroys: lit in red rather than the accent.
	danger?: boolean;
	// TooltipLayer strips `title` while open, so tests find buttons by this.
	testId?: string;
	// A tag's own colour, washed into fill and border.
	tint?: string;
	// Pressed and held, e.g. the tag the board is narrowed to. Needs a `tint`.
	held?: boolean;
	// Tighter padding, for tags on a card.
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

		// Wash alpha: resting, hovered, held, held and hovered.
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
					// One weight for every button in a row.
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
