import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {CODE_FONT} from '../lib/code-text.style';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {
	HOVER_DELAY_MS,
	Placement,
	placeHoverCard,
	onHoverDismiss,
	TRIGGER_ALIVE_POLL_MS,
} from '../lib/hover-card';
import {TICKET_REF_ATTRIBUTE} from './TicketPreviewLayer';

// The app's tooltip for every `title`, via one delegated listener. No
// animation: it exists to cut latency.

// Where the title is parked: `title` must leave to suppress the native bubble.
const STASH = 'epiqTip';

type Shown = {label: string; trigger: HTMLElement};

/** The element under the pointer that owns a tooltip, if any. */
const triggerFor = (target: EventTarget | null): HTMLElement | null => {
	if (!(target instanceof Element)) return null;

	const owner = target.closest<HTMLElement>(`[title], [data-${'epiq-tip'}]`);

	// A ticket ref has its own preview card instead.
	const refOwner = target.closest(`[${TICKET_REF_ATTRIBUTE}]`);
	if (refOwner && (!owner || owner.contains(refOwner))) return null;

	// An SVG `title` is a child element, not a hover hint, and `<title>` in the
	// document head is neither.
	return owner instanceof HTMLElement ? owner : null;
};

/** Mounted once. Everything else in the GUI keeps writing plain `title`. */
export const TooltipLayer = () => {
	const tip = useRef<HTMLDivElement | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// The element whose `title` is currently parked, so it can always be given
	// back — including when the pointer leaves by way of a click or a scroll.
	const stashed = useRef<HTMLElement | null>(null);
	// The element this tooltip is about, shown or still waiting out its delay.
	// What tells a scroll whether it is one that moved this tooltip.
	const subject = useRef<HTMLElement | null>(null);

	const [shown, setShown] = useState<Shown | null>(null);
	const [placement, setPlacement] = useState<Placement | null>(null);

	useEffect(() => {
		const cancel = () => {
			if (timer.current !== null) clearTimeout(timer.current);
			timer.current = null;
		};

		const restore = () => {
			const element = stashed.current;
			if (!element) return;

			const label = element.dataset[STASH];
			if (label !== undefined) {
				element.setAttribute('title', label);
				delete element.dataset[STASH];
			}

			stashed.current = null;
		};

		const hide = () => {
			cancel();
			restore();
			subject.current = null;
			setShown(null);
		};

		// Strips the attribute only when this tooltip replaces the native one.
		const park = (trigger: HTMLElement, label: string) => {
			trigger.dataset[STASH] = label;
			trigger.removeAttribute('title');
			stashed.current = trigger;
		};

		const open = (trigger: HTMLElement, label: string) => {
			cancel();
			subject.current = trigger;

			timer.current = setTimeout(() => {
				park(trigger, label);
				setShown({label, trigger});
			}, HOVER_DELAY_MS);
		};

		const onOver = (event: MouseEvent) => {
			const trigger = triggerFor(event.target);

			if (!trigger) return hide();
			if (trigger === stashed.current) return;

			const label = trigger.getAttribute('title') ?? trigger.dataset[STASH];

			hide();
			if (label) open(trigger, label);
		};

		// Focus shows at once and keeps the attribute: the native bubble is hover-only,
		// and screen readers need the name.
		const onFocus = (event: FocusEvent) => {
			const trigger = triggerFor(event.target);
			const label = trigger?.getAttribute('title');

			hide();
			if (trigger && label) {
				subject.current = trigger;
				setShown({label, trigger});
			}
		};

		const stopDismiss = onHoverDismiss(hide, () => subject.current);

		document.addEventListener('mouseover', onOver);
		document.addEventListener('focusin', onFocus);
		document.addEventListener('focusout', hide);

		return () => {
			hide();
			stopDismiss();
			document.removeEventListener('mouseover', onOver);
			document.removeEventListener('focusin', onFocus);
			document.removeEventListener('focusout', hide);
		};
	}, []);

	// Measured before paint, which also gives the fade a starting frame.
	useEffect(() => {
		if (!shown) return setPlacement(null);

		const node = tip.current;
		if (!node) return;

		setPlacement(
			placeHoverCard(
				shown.trigger.getBoundingClientRect(),
				node.getBoundingClientRect(),
			),
		);
	}, [shown]);

	useEffect(() => {
		if (!shown) return;

		const check = setInterval(() => {
			if (!shown.trigger.isConnected) setShown(null);
		}, TRIGGER_ALIVE_POLL_MS);

		return () => clearInterval(check);
	}, [shown]);

	if (!shown) return null;

	return createPortal(
		<div
			ref={tip}
			role="tooltip"
			data-testid="tooltip"
			style={{
				position: 'fixed',
				left: placement?.left ?? 0,
				top: placement?.top ?? 0,
				opacity: placement ? 1 : 0,
				transition: 'opacity 80ms ease-out',
				zIndex: 1000,
				pointerEvents: 'none',
				maxWidth: 320,
				padding: '5px 8px',
				borderRadius: 4,
				background: '#000',
				// The inner `line`; fill and shadow already separate it.
				border: `1px solid ${GUI_THEME.line}`,
				boxShadow: '0 4px 14px rgba(0, 0, 0, 0.55)',
				color: GUI_THEME.primary,
				fontFamily: CODE_FONT,
				fontSize: TEXT.meta,
				lineHeight: 1.4,
				whiteSpace: 'pre-wrap',
			}}
		>
			{shown.label}
		</div>,
		document.body,
	);
};
