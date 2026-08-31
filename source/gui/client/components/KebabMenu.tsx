import React, {useEffect, useRef, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

export type KebabMenuItem = {
	id: string;
	label: string;
	// Renders in red. For actions that destroy something.
	danger?: boolean;
	onSelect: () => void;
};

export const KebabMenu = ({
	items = [],
	testId,
	title = 'Actions',
	children,
}: {
	items?: KebabMenuItem[];
	testId?: string;
	title?: string;
	// Rendered above the items, for a menu whose contents are a control rather
	// than a list of commands. Handed the same close the items get, so choosing
	// inside it dismisses the menu and shows what it did.
	children?: (close: () => void) => React.ReactNode;
}) => {
	const [open, setOpen] = useState(false);
	const [hovered, setHovered] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;

		const close = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				setOpen(false);
			}
		};

		const onEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};

		document.addEventListener('mousedown', close);
		document.addEventListener('keydown', onEscape);

		return () => {
			document.removeEventListener('mousedown', close);
			document.removeEventListener('keydown', onEscape);
		};
	}, [open]);

	return (
		<div ref={ref} style={{position: 'relative', display: 'flex'}}>
			<button
				type="button"
				data-testid={testId}
				title={title}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen(value => !value)}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				style={{
					appearance: 'none',
					WebkitAppearance: 'none',
					background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
					border: `1px solid ${
						open || hovered ? GUI_THEME.line : 'transparent'
					}`,
					borderRadius: 6,
					color: open || hovered ? GUI_THEME.secondary : GUI_THEME.dim,
					cursor: 'pointer',
					fontFamily: 'inherit',
					fontSize: 12,
					lineHeight: 1,
					padding: '3px 6px',
					outline: 'none',
					transition: 'color 120ms ease, background 120ms ease',
				}}
			>
				⋮
			</button>

			{open && (
				<div
					role="menu"
					style={{
						position: 'absolute',
						top: 26,
						right: 0,
						minWidth: 140,
						background: GUI_THEME.bg,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 8,
						boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
						padding: 6,
						zIndex: 20,
					}}
				>
					{children?.(() => setOpen(false))}

					{items.map(item => (
						<MenuItem
							key={item.id}
							item={item}
							testId={testId ? `${testId}-${item.id}` : undefined}
							onDone={() => setOpen(false)}
						/>
					))}
				</div>
			)}
		</div>
	);
};

const MenuItem = ({
	item,
	testId,
	onDone,
}: {
	item: KebabMenuItem;
	testId?: string;
	onDone: () => void;
}) => {
	const [hovered, setHovered] = useState(false);
	const color = item.danger ? GUI_THEME.red : GUI_THEME.primary;

	return (
		<button
			type="button"
			role="menuitem"
			data-testid={testId}
			onClick={() => {
				onDone();
				item.onSelect();
			}}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				width: '100%',
				border: 'none',
				background: hovered ? GUI_THEME.line : 'transparent',
				color,
				fontFamily: 'inherit',
				fontSize: 11,
				textAlign: 'left',
				padding: '8px 10px',
				borderRadius: 6,
				cursor: 'pointer',
			}}
		>
			{item.label}
		</button>
	);
};
