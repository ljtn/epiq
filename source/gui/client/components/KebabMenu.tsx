import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {GUI_THEME} from '../lib/gui-theme';
import {IconButton} from './IconButton';
import {usePortalAnchor} from './Menu';
import {popoverStyle} from '../lib/select-style';

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
	icon,
	portal = false,
	children,
}: {
	items?: KebabMenuItem[];
	testId?: string;
	title?: string;
	// What the trigger shows. Three dots by default, for a menu of actions;
	// a menu that holds a state can show the state in force instead.
	icon?: React.ReactNode;
	// Out to the body, under the trigger, for a trigger inside an ancestor
	// that clips.
	portal?: boolean;
	// Rendered above the items, for a menu whose contents are a control rather
	// than a list of commands. Handed the same close the items get, so choosing
	// inside it dismisses the menu and shows what it did.
	children?: (close: () => void) => React.ReactNode;
}) => {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const anchor = usePortalAnchor(open && portal, ref, popoverRef);

	useEffect(() => {
		if (!open) return;

		const close = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				!ref.current?.contains(target) &&
				!popoverRef.current?.contains(target)
			) {
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

	const popover = (
		<div
			ref={popoverRef}
			role="menu"
			style={{
				...(portal
					? {
							position: 'fixed',
							left: anchor?.left ?? 0,
							top: anchor?.top ?? 0,
							// Measured before it is placed.
							visibility: anchor ? 'visible' : 'hidden',
					  }
					: {position: 'absolute', top: 26, right: 0}),
				minWidth: 140,
				background: GUI_THEME.bg,
				border: `1px solid ${GUI_THEME.line}`,
				borderRadius: 8,
				boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
				padding: 6,
				// Out on the body it takes the layer Menu's popovers do: over the
				// panels, under modals and tooltips.
				zIndex: portal ? popoverStyle.zIndex : 20,
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
	);

	return (
		<div ref={ref} style={{position: 'relative', display: 'flex'}}>
			<IconButton
				testId={testId}
				title={title}
				pressed={open}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen(value => !value)}
			>
				{icon ?? '⋮'}
			</IconButton>

			{open && (portal ? createPortal(popover, document.body) : popover)}
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
