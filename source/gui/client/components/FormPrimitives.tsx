import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
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

export const ChipRow = ({children}: {children: React.ReactNode}) => (
	<div style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10}}>
		{children}
	</div>
);

export const Empty = ({children}: {children: React.ReactNode}) => (
	<span style={{display: 'inline-block', marginTop: 8, color: GUI_THEME.dim}}>
		{children}
	</span>
);
