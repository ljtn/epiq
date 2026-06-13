import React from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
	<input
		{...props}
		style={{
			width: '100%',
			boxSizing: 'border-box',
			background: GUI_THEME.bg,
			color: GUI_THEME.primary,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			padding: '8px 10px',
			outline: 'none',
			font: 'inherit',
			...props.style,
		}}
	/>
);

export const Textarea = (
	props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) => (
	<textarea
		maxLength={props.maxLength ?? 100}
		{...props}
		style={{
			width: '100%',
			minHeight: 140,
			boxSizing: 'border-box',
			background: GUI_THEME.bg,
			color: GUI_THEME.primary,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 8,
			padding: '8px 10px',
			outline: 'none',
			lineHeight: 1.6,
			resize: 'vertical',
			font: 'inherit',
			...props.style,
		}}
	/>
);

export const ActionRow = ({children}: {children: React.ReactNode}) => (
	<div
		style={{display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8}}
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
