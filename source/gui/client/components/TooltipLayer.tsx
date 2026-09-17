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

// The app's own tooltip, in place of the browser's, for every `title` in the
// GUI at once.
//
// One delegated listener rather than a wrapper around each trigger: there are
// about 110 `title` attributes here, wrapping them all would be an enormous
// diff, and every one written afterwards would go back to the browser's own.
// This way `title="…"` keeps meaning what it always meant and simply looks
// like the rest of the app.
//
// No typing animation, deliberately. A tooltip is asked for because somebody
// does not know something, so any animation buys back the latency this exists
// to remove — and it fires dozens of times an hour, which is where a charming
// effect turns into something you wait through.

// Where the title text is parked while the attribute is off the element. It
// has to leave: there is no way to keep `title` and suppress the native bubble,
// and both showing at once is worse than either.
const STASH = 'epiqTip';

type Shown = {label: string; trigger: HTMLElement};

/** The element under the pointer that owns a tooltip, if any. */
const triggerFor = (target: EventTarget | null): HTMLElement | null => {
	if (!(target instanceof Element)) return null;

	const owner = target.closest<HTMLElement>(`[title], [data-${'epiq-tip'}]`);

	// A linkified ticket ref has a hint of its own — TicketPreviewLayer's card.
	// Without this, an enclosing element's plain `title` would open beside it,
	// two boxes describing the same word.
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

		// Only the pointer strips the attribute, and only at the moment this
		// tooltip replaces the browser's — the native bubble waits about a
		// second, so there is no race to win by taking it earlier, and holding
		// the attribute as long as possible keeps the element findable by it.
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

		// Arriving by tab is deliberate in a way that crossing with a pointer is
		// not, so there is no delay — and the attribute stays put, since browsers
		// draw the native bubble on hover only. Stripping it here would take a
		// button's accessible name away at the exact moment a screen reader is
		// on it.
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

	// Measured once it is in the document, so the first painted frame is already
	// in the right place — and that pass is what gives the fade a frame to start
	// from.
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
				// The panel's inner `line`, not its outer `edge`: the black fill and
				// the shadow already hold this apart from the page, so the border
				// only has to describe an edge rather than carry one.
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
