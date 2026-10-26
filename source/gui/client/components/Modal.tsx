import React, {useEffect} from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';

// Every dialog's frame: the scrim, the card, the eyebrow naming it and the
// actions along the bottom. The card sets the one size its text is read at,
// so an input or a list inside it is the size of the words around it.

export const Modal = ({
	testId,
	eyebrow,
	danger = false,
	width = 420,
	onClose,
	onSubmit,
	actions,
	children,
}: {
	testId?: string;
	eyebrow: string;
	// The eyebrow in red, for a dialog that destroys something.
	danger?: boolean;
	width?: number;
	onClose: () => void;
	// Given, the card is a form, and Enter in it submits.
	onSubmit?: () => void;
	actions: React.ReactNode;
	children: React.ReactNode;
}) => {
	// On the window, so it closes whatever has focus; a field that takes Escape
	// for itself stops it first.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	const card = {
		'data-testid': testId,
		onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
		onClick: (event: React.MouseEvent) => event.stopPropagation(),
		style: {
			marginTop: '-100px',
			width,
			background: GUI_THEME.panel,
			border: `1px solid ${GUI_THEME.line}`,
			borderRadius: 12,
			padding: 20,
			display: 'flex',
			flexDirection: 'column',
			gap: 14,
			fontSize: TEXT.ui,
			color: GUI_THEME.secondary,
		} satisfies React.CSSProperties,
	};
	const content = (
		<>
			<div
				style={{
					color: danger ? GUI_THEME.red : GUI_THEME.secondary,
					fontSize: TEXT.label,
					letterSpacing: 1,
					textTransform: 'uppercase',
				}}
			>
				{eyebrow}
			</div>
			{children}
			<div style={{display: 'flex', justifyContent: 'flex-end', gap: 10}}>
				{actions}
			</div>
		</>
	);

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: GUI_THEME.scrim,
				backdropFilter: 'blur(.5px)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 1000,
			}}
			onMouseDown={onClose}
		>
			{onSubmit ? (
				<form
					{...card}
					onSubmit={event => {
						event.preventDefault();
						onSubmit();
					}}
				>
					{content}
				</form>
			) : (
				<div {...card}>{content}</div>
			)}
		</div>
	);
};

/** What a dialog asks, over its words. */
export const ModalHeading = ({children}: {children: React.ReactNode}) => (
	<h2
		style={{
			margin: 0,
			fontSize: TEXT.prose,
			fontWeight: 600,
			color: GUI_THEME.primary,
		}}
	>
		{children}
	</h2>
);

/** A dialog's own words, at the size its card sets. */
export const ModalText = ({children}: {children: React.ReactNode}) => (
	<p style={{margin: 0, lineHeight: 1.7}}>{children}</p>
);

/** The rows a manage dialog lists, scrolling past a few. */
export const ModalList = ({children}: {children: React.ReactNode}) => (
	<div
		style={{
			display: 'flex',
			flexDirection: 'column',
			gap: 2,
			maxHeight: 260,
			overflowY: 'auto',
		}}
	>
		{children}
	</div>
);
