import React, {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {menuRowHoverBackground} from '../lib/select-style';

export const Input = (props: React.ComponentProps<'input'>) => (
	<input
		{...props}
		style={{
			// The shorthand first: it resets the longhands after it, and a
			// caller's spread keeps a key's first position, so a line height
			// set by the caller would otherwise be undone by this.
			font: 'inherit',
			width: '100%',
			boxSizing: 'border-box',
			// A place to type reads as recessed: a step down from the panel it
			// sits on, not the page's black, which read as a hole in it.
			background: GUI_THEME.well,
			color: GUI_THEME.primary,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			padding: '8px 10px',
			outline: 'none',
			...props.style,
		}}
	/>
);

// Forwards its ref: inserting an image at the cursor has to read
// selectionStart off the element, which only the owner of the ref can do.
export const Textarea = React.forwardRef<
	HTMLTextAreaElement,
	React.TextareaHTMLAttributes<HTMLTextAreaElement>
>((props, ref) => (
	<textarea
		ref={ref}
		maxLength={props.maxLength ?? 1500}
		{...props}
		style={{
			font: 'inherit',
			width: '100%',
			minHeight: 140,
			boxSizing: 'border-box',
			background: GUI_THEME.well,
			color: GUI_THEME.primary,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			padding: '8px 10px',
			outline: 'none',
			lineHeight: 1.6,
			resize: 'vertical',
			...props.style,
		}}
	/>
));

Textarea.displayName = 'Textarea';

export const ActionRow = ({
	children,
	style,
}: {
	children: React.ReactNode;
	style?: React.CSSProperties;
}) => (
	<div
		style={{
			display: 'flex',
			justifyContent: 'flex-end',
			gap: 8,
			marginTop: 8,
			...style,
		}}
	>
		{children}
	</div>
);

export const AddRow = ({children}: {children: React.ReactNode}) => (
	<div style={{display: 'flex', gap: 8, marginTop: 10}}>{children}</div>
);

// How far a row's hover ground reaches past the column its text keeps to.
// The panel's pane leaves this much room for it on the left.
export const HOVER_REACH = 6;
const EMPTY_INSET = HOVER_REACH;
const EMPTY_PAD_Y = 6;

// Given `onActivate`, the row's own ground does what its section's control
// does, as `Empty` does before there is a chip: only a click on the ground
// between and beside the chips, never one on a chip, which has its own.
export const ChipRow = ({
	children,
	onActivate,
	testId,
}: {
	children: React.ReactNode;
	onActivate?: () => void;
	testId?: string;
}) => {
	const [lit, setLit] = useState(false);

	if (!onActivate) {
		return (
			<div style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10}}>
				{children}
			</div>
		);
	}

	const onGround = (event: React.MouseEvent) =>
		event.target === event.currentTarget;

	return (
		<div
			data-testid={testId}
			onClick={event => onGround(event) && onActivate()}
			onMouseMove={event => setLit(onGround(event))}
			onMouseLeave={() => setLit(false)}
			style={{
				display: 'flex',
				gap: 8,
				flexWrap: 'wrap',
				// Pulled out and padded back as `Empty` is, so the chips stay put and
				// only the ground reaches past them.
				marginTop: 10 - EMPTY_PAD_Y,
				marginBottom: -EMPTY_PAD_Y,
				marginLeft: -EMPTY_INSET,
				padding: `${EMPTY_PAD_Y}px ${EMPTY_INSET}px`,
				borderRadius: 6,
				background: lit ? menuRowHoverBackground : 'transparent',
				cursor: lit ? 'pointer' : undefined,
			}}
		>
			{children}
		</div>
	);
};

// Given `onActivate`, it does what its section's control does: the biggest
// target there, which otherwise reads as dead text right under it.
export const Empty = ({
	children,
	onActivate,
	testId,
}: {
	children: React.ReactNode;
	onActivate?: () => void;
	testId?: string;
}) => {
	const [lit, setLit] = useState(false);

	if (!onActivate) {
		return (
			<span
				data-testid={testId}
				style={{display: 'inline-block', marginTop: 8, color: GUI_THEME.dim}}
			>
				{children}
			</span>
		);
	}

	return (
		<button
			type="button"
			data-testid={testId}
			onClick={onActivate}
			onMouseEnter={() => setLit(true)}
			onMouseLeave={() => setLit(false)}
			onFocus={event => setLit(event.currentTarget.matches(':focus-visible'))}
			onBlur={() => setLit(false)}
			style={{
				font: 'inherit',
				display: 'block',
				boxSizing: 'border-box',
				// Inset by as much as it is pulled out, so the text stays where the
				// plain one sits and only the hover ground reaches past it. Taller than
				// its line, for an easy target, and pulled back by the same amount
				// above and below so nothing around it moves.
				width: `calc(100% + ${EMPTY_INSET}px)`,
				marginTop: 8 - EMPTY_PAD_Y,
				marginBottom: -EMPTY_PAD_Y,
				marginLeft: -EMPTY_INSET,
				padding: `${EMPTY_PAD_Y}px ${EMPTY_INSET}px`,
				border: 'none',
				borderRadius: 6,
				outline: 'none',
				// A menu row's hover: the blue-grey of the quiet ink it carries, so
				// the ground and the words read as one tint.
				background: lit ? menuRowHoverBackground : 'transparent',
				color: GUI_THEME.dim,
				textAlign: 'left',
				cursor: 'pointer',
			}}
		>
			{children}
		</button>
	);
};
