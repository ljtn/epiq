// Every dropdown in the GUI: a trigger that names what is chosen, and a popover
// of rows that light under the pointer. Rows hold whatever the menu asks —
// an option, a checkbox, a radio — and the menu owns how they look.

import React, {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import {createPortal} from 'react-dom';
import {GUI_THEME, UI_FONT} from '../lib/gui-theme';
import {
	menuRowHoverBackground,
	popoverStyle,
	selectLabelStyle,
	selectTriggerStyle,
} from '../lib/select-style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {IconChevronDown} from './IconChevronDown';

export const Menu = ({
	label,
	color = GUI_THEME.dim,
	width,
	minWidth,
	disabled = false,
	testId,
	title,
	popupRole = 'listbox',
	popupLabel,
	triggerStyle,
	chevronSize = 12,
	leading,
	portal = false,
	open: controlledOpen,
	onOpenChange,
	children,
}: {
	label: React.ReactNode;
	color?: string;
	width?: number;
	// The popover's, when it should not simply match the trigger.
	minWidth?: number;
	disabled?: boolean;
	testId?: string;
	title?: string;
	popupRole?: 'listbox' | 'group' | 'menu';
	popupLabel?: string;
	triggerStyle?: React.CSSProperties;
	chevronSize?: number;
	// Drawn before the trigger, inside the area a click does not dismiss from.
	leading?: React.ReactNode;
	// Out to the body, for a trigger inside an ancestor that clips.
	portal?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: (close: () => void) => React.ReactNode;
}) => {
	const [ownOpen, setOwnOpen] = useState(false);
	const open = (controlledOpen ?? ownOpen) && !disabled;
	const setOpen = (next: boolean) => {
		if (controlledOpen === undefined) setOwnOpen(next);
		onOpenChange?.(next);
	};
	const close = () => setOpen(false);

	// Shut, not just hidden, so re-enabling does not reopen it.
	useEffect(() => {
		if (!disabled) return;
		setOwnOpen(false);
		if (controlledOpen) onOpenChange?.(false);
	}, [disabled]);

	const listId = useId();
	const listRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const ref = useDismissOnOutsideClick(open, close, [listRef]);
	const anchor = usePortalAnchor(portal && open, triggerRef);

	const popover = (
		<div
			ref={listRef}
			id={listId}
			role={popupRole}
			aria-label={popupLabel}
			style={{
				...popoverStyle,
				minWidth: minWidth ?? width ?? popoverStyle.minWidth,
				...(portal && anchor
					? {
							position: 'fixed',
							left: anchor.left,
							top: anchor.top,
							marginTop: 0,
							// A portal inherits from the body, not the app.
							fontFamily: UI_FONT,
					  }
					: {}),
			}}
		>
			{children(close)}
		</div>
	);

	return (
		<div ref={ref} style={{position: 'relative', flexShrink: 0}}>
			<div style={{display: 'flex', alignItems: 'center', gap: 6}}>
				{leading}
				<button
					ref={triggerRef}
					type="button"
					data-testid={testId}
					onClick={() => setOpen(!open)}
					disabled={disabled}
					aria-haspopup={popupRole === 'group' ? 'true' : popupRole}
					aria-controls={open ? listId : undefined}
					aria-expanded={open}
					title={title}
					style={{
						...selectTriggerStyle(color, disabled),
						...(width ? {width} : {}),
						...triggerStyle,
					}}
				>
					<span style={selectLabelStyle}>{label}</span>
					<span style={{display: 'inline-flex', flexShrink: 0}}>
						<IconChevronDown size={chevronSize} />
					</span>
				</button>
			</div>

			{open &&
				(portal ? anchor && createPortal(popover, document.body) : popover)}
		</div>
	);
};

const usePortalAnchor = (
	active: boolean,
	triggerRef: React.RefObject<HTMLButtonElement | null>,
) => {
	const [anchor, setAnchor] = useState<{left: number; top: number} | null>(
		null,
	);

	useLayoutEffect(() => {
		if (!active) return;

		const place = () => {
			const box = triggerRef.current?.getBoundingClientRect();
			if (box) setAnchor({left: box.left, top: box.bottom + 6});
		};

		place();
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);

		return () => {
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
		};
	}, [active, triggerRef]);

	return anchor;
};

// One row of a menu. Given `onSelect` it is the clickable option itself;
// without, it frames a control of its own — a checkbox, a radio.
export const MenuItem = ({
	children,
	selected = false,
	onSelect,
	role,
	testId,
	title,
	style,
}: {
	children: React.ReactNode;
	selected?: boolean;
	onSelect?: () => void;
	role?: 'option';
	testId?: string;
	title?: string;
	style?: React.CSSProperties;
}) => {
	const [hovered, setHovered] = useState(false);

	const rowStyle: React.CSSProperties = {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 10,
		width: '100%',
		boxSizing: 'border-box',
		border: 'none',
		borderRadius: 6,
		padding: '6px 8px',
		background: selected
			? GUI_THEME.line
			: hovered
			? menuRowHoverBackground
			: 'transparent',
		color: selected ? GUI_THEME.accent : GUI_THEME.primary,
		fontFamily: 'inherit',
		fontSize: 11,
		textAlign: 'left',
		...style,
	};

	const hover = {
		onMouseEnter: () => setHovered(true),
		onMouseLeave: () => setHovered(false),
	};

	return onSelect ? (
		<button
			type="button"
			role={role}
			aria-selected={role ? selected : undefined}
			data-testid={testId}
			title={title}
			onClick={onSelect}
			style={{...rowStyle, cursor: 'pointer'}}
			{...hover}
		>
			{children}
		</button>
	) : (
		<div
			data-testid={testId}
			title={title}
			// The whole lit row answers, not just the control's own box and label.
			onClick={event => {
				if (event.target !== event.currentTarget) return;
				event.currentTarget
					.querySelector<HTMLElement>('input, button')
					?.click();
			}}
			style={{...rowStyle, cursor: 'pointer'}}
			{...hover}
		>
			{children}
		</div>
	);
};
