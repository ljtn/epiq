import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {CODE_FONT} from '../lib/code-text.style';
import {CONTENT_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {
	HOVER_DELAY_MS,
	Placement,
	placeHoverCard,
	onHoverDismiss,
	TRIGGER_ALIVE_POLL_MS,
} from '../lib/hover-card';
import {TicketPreview} from '../lib/use-ticket-previews';

// What a ticket ref shows before you commit to opening it: the ticket's title,
// where it sits, and the opening of its description.
//
// A sibling of TooltipLayer rather than part of it — that one is one delegated
// listener giving every `title` in the GUI the same look, and a `title` is a
// string. This draws a card, and only over the refs a description or comment
// linkified, so the two share their timing and placement (lib/hover-card) and
// nothing else.
//
// Deliberately not interactive: nothing in the card can be clicked, so there
// is no pointer journey from the ref into it to keep alive, and no way for it
// to swallow a click meant for the text underneath. The ref itself is already
// the button that opens the ticket.

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
				<span style={{color: GUI_THEME.green}}>closed</span>
			</>
		)}
	</div>
);

// Tag names in their own colours rather than the chip `Button` a panel or a
// card uses. That chip is a control — it removes the tag, or narrows the board
// to it — and its whole shape is about being pressable. Here the same names
// are being read, not operated, so they are text.
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
				fontFamily: CONTENT_FONT,
				fontSize: TEXT.prose,
				lineHeight: 1.35,
				color: GUI_THEME.primary,
			}}
		>
			{preview.title}
		</div>

		<Meta preview={preview} />

		{/* Undefined is "still being fetched", and drawing nothing for it keeps
		    the card from resizing under the pointer a moment after it opens.
		    An empty string is an answer: this ticket has no description. */}
		{preview.excerpt !== undefined && preview.excerpt !== '' && (
			<div
				style={{
					fontFamily: CONTENT_FONT,
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

		// Which ticket the pointer is over decides this, not which element:
		// every state broadcast re-renders the prose these controls live in, and
		// a replaced node fires `mouseover` again. Keying off the node would
		// read each of those as a fresh hover and restart the wait, so on a
		// board anything is happening on the card would never open at all.
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

	// Measured once it is in the document, so the first painted frame is
	// already in the right place — and re-measured when the excerpt lands and
	// makes the card taller.
	//
	// `Boolean(preview)` is in the deps, not `preview` itself, which is rebuilt
	// on every render: a ref whose ticket is momentarily absent from the board
	// state (mid-scrub, or a board that left the broadcast) draws no card, so
	// this runs against no node — and without something to re-run on, the card
	// would mount at opacity 0 when the ticket came back and stay there until
	// the pointer left and returned.
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

	// A ref that resolved when it was linkified but not now — the ticket moved
	// to a board this client stopped being told about, or the board is
	// mid-scrub — draws nothing rather than an empty card.
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
