import {Fragment, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {CONTENT_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {CARD, CARD_RADIUS, META, SECTION_LABEL} from '../lib/card.style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {ASIDE_PADDING} from './Aside';
import {IconButton} from './IconButton';
import {IconChevronDown} from './IconChevronDown';
import {IconClose} from './IconClose';
import {SectionRule} from './SectionRule';

// The board's setup, as against its content: who the viewer is, what this
// machine does on its own, which repos are read. One panel from the right
// edge under the topbar rather than a popover and a modal, so each setting
// has a fixed place and the board stays in view behind it.
//
// Built like the ticket aside — the same shadow and padding — and told apart
// from it by its face and its ground: the prose font on a well of cards,
// where every panel about the board's work is monospace on the raised panel.
// It is about the system, not the work.
//
// One card per section, under a heading for its scope: the sections are
// about the viewer, this machine and the project, and the heading says which
// before any card does. Only the section the panel was opened for is
// unfolded, so the control that opened it lands on what it promised.

export type SettingsSection = 'identity' | 'addresses' | 'sync' | 'repos';

// What the panel was opened for: a section, unfolded and scrolled to, or the
// overview — the gear — with every card folded.
export type SettingsFocus = SettingsSection | 'overview';

export type SettingsSectionSpec = {
	id: SettingsSection;
	title: string;
	// Whose setting it is: the heading over the cards that share it.
	scope: string;
	// The state in a word or two, read off the header without unfolding it:
	// "on", "2 linked". Null while it is not yet known.
	summary: string | null;
	content: React.ReactNode;
};

/** As wide as the identity popover it replaces. */
export const SETTINGS_WIDTH = 440;

// Under the modals and the palette, over everything the board draws.
const Z_INDEX = 900;

const CARD_PADDING = 16;
// Inside the card's border, so the corners meet it.
const INNER = CARD_RADIUS - 1;

const SLIDE = `
	@keyframes epiqSettingsSlide {
		from { transform: translateX(100%); }
		to { transform: translateX(0); }
	}
`;

const Fold = ({
	spec,
	open,
	onToggle,
}: {
	spec: SettingsSectionSpec;
	open: boolean;
	onToggle: () => void;
}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<section data-section={spec.id} style={CARD}>
			<button
				type="button"
				data-testid={`settings-section-${spec.id}`}
				aria-expanded={open}
				onClick={onToggle}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 10,
					width: '100%',
					padding: `14px ${CARD_PADDING}px`,
					background: hovered ? GUI_THEME.hover : 'transparent',
					border: 'none',
					// The card's own corners, and only the top two while the body
					// continues under it.
					borderRadius: open ? `${INNER}px ${INNER}px 0 0` : INNER,
					color: GUI_THEME.primary,
					cursor: 'pointer',
					fontFamily: 'inherit',
					fontSize: TEXT.prose,
					fontWeight: 600,
					textAlign: 'left',
				}}
			>
				<span
					style={{
						flex: 1,
						minWidth: 0,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{spec.title}
				</span>
				{spec.summary && (
					<span
						data-testid={`settings-summary-${spec.id}`}
						// Quieter than a note: a word the eye can skip.
						style={{
							...META,
							marginTop: 0,
							fontSize: TEXT.meta,
							fontWeight: 400,
							opacity: 0.7,
							whiteSpace: 'nowrap',
						}}
					>
						{spec.summary}
					</span>
				)}
				<span
					style={{
						display: 'inline-flex',
						color: GUI_THEME.dim,
						transform: open ? undefined : 'rotate(-90deg)',
						transition: 'transform 120ms ease-out',
					}}
				>
					<IconChevronDown size={14} />
				</span>
			</button>

			{open && (
				// A shade down from the header, so the header reads as the handle
				// and the body as what it opened. A tint of the card, not a
				// colour of its own, and no rule between: the shade is the edge.
				<div
					style={{
						// Less below than beside: what ends a body carries padding of
						// its own, a row's or a button's.
						padding: `0 ${CARD_PADDING}px 12px`,
						borderRadius: `0 0 ${INNER}px ${INNER}px`,
						background: 'rgba(0, 0, 0, 0.12)',
					}}
				>
					{spec.content}
				</div>
			)}
		</section>
	);
};

// The scope's line over its cards: the menus' section rule at the panel's
// size and spacing.
const Scope = ({label, first}: {label: string; first: boolean}) => (
	<SectionRule
		label={label}
		style={{gap: 10, marginTop: first ? 6 : 22, marginBottom: 8}}
		labelStyle={{
			...SECTION_LABEL,
			fontSize: TEXT.label,
			letterSpacing: '0.1em',
		}}
	/>
);

export const SettingsPanel = ({
	section,
	sections,
	below,
	keepOpenFor,
	onClose,
}: {
	// Which section the panel was opened for: unfolded and scrolled to.
	section: SettingsFocus;
	sections: SettingsSectionSpec[];
	// The topbar, which this sits under: its triggers stay in reach.
	below: React.RefObject<HTMLElement | null>;
	// The controls that open and close this: a click on one is not a click
	// outside, or the panel would close under it and open again on the click.
	keepOpenFor: React.RefObject<HTMLElement | null>[];
	onClose: () => void;
}) => {
	const panel = useDismissOnOutsideClick(true, onClose, keepOpenFor);
	const scroller = useRef<HTMLDivElement | null>(null);

	// Focus on opening, and back where it was on closing: opened from the
	// keyboard, Tab must move through the panel rather than past it, and
	// Escape must leave the reader where they were.
	useEffect(() => {
		const before = document.activeElement;
		panel.current?.focus();

		return () => {
			if (before instanceof HTMLElement && before.isConnected) before.focus();
		};
	}, [panel]);
	const [open, setOpen] = useState<ReadonlySet<SettingsSection>>(
		() => new Set(section === 'overview' ? [] : [section]),
	);
	const [top, setTop] = useState(0);

	// Measured rather than taken from a constant: the topbar wraps on a narrow
	// window, and the panel must start where it ends either way.
	useLayoutEffect(() => {
		const place = () =>
			setTop(below.current?.getBoundingClientRect().bottom ?? 0);

		place();
		window.addEventListener('resize', place);

		return () => window.removeEventListener('resize', place);
	}, [below]);

	// Asked for again while open — another trigger — unfolds its section too.
	useEffect(() => {
		if (section === 'overview') return;

		setOpen(prev => (prev.has(section) ? prev : new Set([...prev, section])));
	}, [section]);

	// Scrolled to the section asked for, and kept there while the sections
	// above it fill: everything here is fetched on opening, so the section
	// moves down as the answers land. Held until the viewer scrolls, which is
	// read off their input rather than off scroll events, since those are
	// also what the holding causes.
	useEffect(() => {
		const pane = scroller.current;
		if (!pane || section === 'overview') return;

		let held = true;
		const hold = () => {
			if (held) {
				pane
					.querySelector(`[data-section="${section}"]`)
					?.scrollIntoView({block: 'start'});
			}
		};
		const release = () => {
			held = false;
		};

		hold();
		const observer = new ResizeObserver(hold);
		for (const child of Array.from(pane.children)) observer.observe(child);
		pane.addEventListener('wheel', release, {passive: true});
		pane.addEventListener('touchmove', release, {passive: true});
		pane.addEventListener('keydown', release);

		return () => {
			observer.disconnect();
			pane.removeEventListener('wheel', release);
			pane.removeEventListener('touchmove', release);
			pane.removeEventListener('keydown', release);
		};
	}, [section]);

	const toggle = (id: SettingsSection) =>
		setOpen(prev => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<div
			ref={panel}
			id="settings-panel"
			data-testid="settings-panel"
			role="dialog"
			aria-label="Settings"
			tabIndex={-1}
			style={{
				outline: 'none',
				position: 'fixed',
				top,
				right: 0,
				bottom: 0,
				width: SETTINGS_WIDTH,
				maxWidth: '100vw',
				boxSizing: 'border-box',
				zIndex: Z_INDEX,
				// A well, not the aside's raised panel: the cards carry the lift,
				// so the ground under them stays back. The edge is the chrome's
				// quieter one for the same reason.
				background: GUI_THEME.well,
				borderLeft: `1px solid ${GUI_THEME.edgeOnChrome}`,
				boxShadow: '-10px 0 24px rgba(0, 0, 0, 0.45)',
				display: 'flex',
				flexDirection: 'column',
				color: GUI_THEME.primary,
				fontFamily: CONTENT_FONT,
				fontSize: TEXT.prose,
				animation: 'epiqSettingsSlide 180ms ease-out',
			}}
		>
			<style>{SLIDE}</style>

			<div
				data-testid="settings-header"
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 12,
					padding: `14px ${ASIDE_PADDING}px 12px`,
					flexShrink: 0,
				}}
			>
				<span
					style={{
						fontSize: 15,
						fontWeight: 600,
						letterSpacing: '-0.01em',
					}}
				>
					Settings
				</span>
				<IconButton
					title="Close settings"
					testId="close-settings"
					onClick={onClose}
				>
					<IconClose />
				</IconButton>
			</div>

			{/* Everything under the title scrolls as one page. The padding is
			    the scroller's, so the bar runs along the panel's own edge rather
			    than through the cards' margin. */}
			<div
				ref={scroller}
				data-testid="settings-scroller"
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: 'auto',
					display: 'flex',
					flexDirection: 'column',
					gap: 10,
					padding: `0 ${ASIDE_PADDING}px ${ASIDE_PADDING}px`,
				}}
			>
				{sections.map((spec, index) => (
					<Fragment key={spec.id}>
						{spec.scope !== sections[index - 1]?.scope && (
							<Scope label={spec.scope} first={index === 0} />
						)}
						<Fold
							spec={spec}
							open={open.has(spec.id)}
							onToggle={() => toggle(spec.id)}
						/>
					</Fragment>
				))}
			</div>
		</div>
	);
};
