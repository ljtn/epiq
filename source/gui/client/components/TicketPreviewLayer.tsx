import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {CODE_FONT} from '../lib/code-text.style';
import {SANS_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {
	HOVER_DELAY_MS,
	Placement,
	placeHoverCard,
	onHoverDismiss,
	TRIGGER_ALIVE_POLL_MS,
} from '../lib/hover-card';
import {TicketPreview} from '../lib/use-ticket-previews';

// The hover card for a linkified ticket ref: title, lane and description
// opening. Shares timing with TooltipLayer (lib/hover-card); not interactive.

/** Set by MarkdownContent on the control it renders for a linkified ref. */
export const TICKET_REF_ATTRIBUTE = 'data-ticket-ref';

const MAX_WIDTH = 360;

const triggerFor = (target: EventTarget | null): HTMLElement | null => {
	if (!(target instanceof Element)) return null;

	return target.closest<HTMLElement>(`[${TICKET_REF_ATTRIBUTE}]`);
};

const Meta = ({preview}: {preview: TicketPreview}) => (
	<div
		style={{
			fontFamily: CODE_FONT,
			fontSize: TEXT.label,
			color: GUI_THEME.dim2,
			display: 'flex',
			gap: 6,
			flexWrap: 'wrap',
		}}
	>
		<span style={{color: GUI_THEME.secondary}}>{preview.ref}</span>
		<span>·</span>
		<span>{preview.lane}</span>
		{preview.isClosed && (
			<>
				<span>·</span>
				<span style={{color: GUI_THEME.green}}>Closed</span>
			</>
		)}
	</div>
);

// Tag names as coloured text, since nothing here is pressable.
const Tags = ({preview}: {preview: TicketPreview}) => (
	<div
		style={{
			display: 'flex',
			gap: 8,
			flexWrap: 'wrap',
			fontFamily: CODE_FONT,
			fontSize: TEXT.label,
		}}
	>
		{preview.tags.map(tag => (
			<span key={tag.id} style={{color: tag.color}}>
				{tag.name}
			</span>
		))}
	</div>
);

const Card = ({preview}: {preview: TicketPreview}) => (
	<div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
		<div
			style={{
				fontFamily: SANS_FONT,
				fontSize: TEXT.prose,
				lineHeight: 1.35,
				color: GUI_THEME.primary,
			}}
		>
			{preview.title}
		</div>

		<Meta preview={preview} />

		{/* Undefined is still loading; '' means no description. */}
		{preview.excerpt !== undefined && preview.excerpt !== '' && (
			<div
				style={{
					fontFamily: SANS_FONT,
					fontSize: TEXT.meta,
					lineHeight: 1.5,
					color: GUI_THEME.secondary,
				}}
			>
				{preview.excerpt}
			</div>
		)}

		{preview.tags.length > 0 && <Tags preview={preview} />}

		{preview.assignees.length > 0 && (
			<div
				style={{
					fontFamily: CODE_FONT,
					fontSize: TEXT.label,
					color: GUI_THEME.dim2,
				}}
			>
				{preview.assignees.map(assignee => assignee.name).join(', ')}
			</div>
		)}
	</div>
);

type Shown = {ref: string; trigger: HTMLElement};

export const TicketPreviewLayer = ({
	previewFor,
	onHover,
}: {
	previewFor: (ref: string) => TicketPreview | null;
	// The hover itself, so the excerpt can start being fetched while the delay
	// below is still running — by the time the card opens it is usually there.
	onHover: (ref: string) => void;
}) => {
	const card = useRef<HTMLDivElement | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [shown, setShown] = useState<Shown | null>(null);
	const [placement, setPlacement] = useState<Placement | null>(null);

	// Read on every render rather than captured when the card opened: the
	// excerpt arrives after the fact, and this is what lets it appear.
	const preview = shown ? previewFor(shown.ref) : null;

	// The handler below is attached once, so it reads the current `onHover`
	// through a ref rather than re-attaching whenever the caller rebuilds it.
	const hover = useRef(onHover);
	hover.current = onHover;

	// What the card is currently for, readable from the listener below without
	// making it depend on the state it sets.
	const shownNow = useRef<Shown | null>(null);
	shownNow.current = shown;

	// What the delay is running for. Held rather than captured in the timer,
	// so the element can be swapped underneath it without the wait restarting.
	const pending = useRef<Shown | null>(null);

	useEffect(() => {
		const hide = () => {
			if (timer.current !== null) clearTimeout(timer.current);
			timer.current = null;
			pending.current = null;
			setShown(null);
		};

		// Keyed by ticket, not node: broadcasts replace nodes, re-firing `mouseover`.
		const onOver = (event: MouseEvent) => {
			const trigger = triggerFor(event.target);
			const ref = trigger?.getAttribute(TICKET_REF_ATTRIBUTE);

			if (!trigger || !ref) return hide();

			if (shownNow.current?.ref === ref) {
				// Same ticket, new node: follow it, so the card stays put against
				// the control that is actually on screen.
				if (shownNow.current.trigger !== trigger) setShown({ref, trigger});
				return;
			}

			if (pending.current?.ref === ref) {
				pending.current = {ref, trigger};
				return;
			}

			hide();
			hover.current(ref);
			pending.current = {ref, trigger};

			timer.current = setTimeout(() => {
				const next = pending.current;
				pending.current = null;
				if (next) setShown(next);
			}, HOVER_DELAY_MS);
		};

		const stopDismiss = onHoverDismiss(
			hide,
			() => shownNow.current?.trigger ?? pending.current?.trigger ?? null,
		);
		document.addEventListener('mouseover', onOver);

		return () => {
			hide();
			stopDismiss();
			document.removeEventListener('mouseover', onOver);
		};
	}, []);

	// Measured before paint and again when the excerpt lands. Depends on
	// `Boolean(preview)`, so a ticket that briefly vanishes still remeasures.
	const hasPreview = Boolean(preview);

	useEffect(() => {
		if (!shown) return setPlacement(null);

		const node = card.current;
		if (!node) return;

		setPlacement(
			placeHoverCard(
				shown.trigger.getBoundingClientRect(),
				node.getBoundingClientRect(),
			),
		);
	}, [shown, hasPreview, preview?.excerpt]);

	useEffect(() => {
		if (!shown) return;

		const check = setInterval(() => {
			if (!shown.trigger.isConnected) setShown(null);
		}, TRIGGER_ALIVE_POLL_MS);

		return () => clearInterval(check);
	}, [shown]);

	// A ref that no longer resolves draws nothing.
	if (!shown || !preview) return null;

	return createPortal(
		<div
			ref={card}
			role="tooltip"
			data-testid="ticket-preview"
			style={{
				position: 'fixed',
				left: placement?.left ?? 0,
				top: placement?.top ?? 0,
				opacity: placement ? 1 : 0,
				transition: 'opacity 80ms ease-out',
				zIndex: 1000,
				pointerEvents: 'none',
				maxWidth: MAX_WIDTH,
				padding: '10px 12px',
				borderRadius: 6,
				background: GUI_THEME.panel,
				border: `1px solid ${GUI_THEME.edge}`,
				boxShadow: '0 6px 20px rgba(0, 0, 0, 0.6)',
			}}
		>
			<Card preview={preview} />
		</div>,
		document.body,
	);
};
