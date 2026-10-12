import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {CONTENT_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {SECTION_LABEL} from '../lib/identity-panel.style';
import {PANE_HEADER_INSET} from '../lib/pane-header.style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {ASIDE_PADDING} from './Aside';
import {Button} from './Button';
import {IconChevronDown} from './IconChevronDown';

// The board's setup, as against its content: who the viewer is, what this
// machine does on its own, which repos are read. One panel from the right
// edge under the topbar rather than a popover and a modal, so each setting
// has a fixed place and the board stays in view behind it.
//
// Built like the ticket aside — the same edge, shadow, padding and header
// band — and told apart from it by its face and its ground: the prose font
// over a surface one step up, where every panel about the board's work is
// monospace on the panel colour. It is about the system, not the work.
//
// One fold per section, each named for its scope: the three are about the
// viewer, this machine and the project, and only the one the panel was opened
// for is open, so the control that opened it lands on what it promised.

export type SettingsSection = 'identity' | 'sync' | 'repos';

export type SettingsSectionSpec = {
	id: SettingsSection;
	title: string;
	// Whose setting it is: what the heading says beside the title.
	scope: string;
	content: React.ReactNode;
};

/** As wide as the identity popover it replaces. */
export const SETTINGS_WIDTH = 440;

// Under the modals and the palette, over everything the board draws.
const Z_INDEX = 900;

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
}) => (
	<div data-section={spec.id}>
		<button
			type="button"
			data-testid={`settings-section-${spec.id}`}
			aria-expanded={open}
			onClick={onToggle}
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 8,
				width: '100%',
				padding: '12px 0',
				background: 'transparent',
				border: 'none',
				borderBottom: `1px solid ${GUI_THEME.line}`,
				color: GUI_THEME.primary,
				cursor: 'pointer',
				fontFamily: 'inherit',
				fontSize: TEXT.prose,
				textAlign: 'left',
			}}
		>
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
			<span style={{flex: 1, minWidth: 0}}>{spec.title}</span>
			<span style={{...SECTION_LABEL, textTransform: 'none', letterSpacing: 0}}>
				{spec.scope}
			</span>
		</button>
		{open && <div style={{paddingBottom: 8}}>{spec.content}</div>}
	</div>
);

export const SettingsPanel = ({
	section,
	sections,
	below,
	keepOpenFor,
	onClose,
}: {
	// Which section the panel was opened for: unfolded and scrolled to.
	section: SettingsSection;
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
	const [open, setOpen] = useState<ReadonlySet<SettingsSection>>(
		() => new Set([section]),
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

	// Asked for again while open — the other trigger — unfolds its section too.
	useEffect(() => {
		setOpen(prev => (prev.has(section) ? prev : new Set([...prev, section])));
	}, [section]);

	// Scrolled to the section asked for, and kept there while the sections
	// above it fill: everything here is fetched on opening, so the section
	// moves down as the answers land. Held until the viewer scrolls, which is
	// read off their input rather than off scroll events, since those are
	// also what the holding causes.
	useEffect(() => {
		const pane = scroller.current;
		if (!pane) return;

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
			data-testid="settings-panel"
			role="dialog"
			aria-label="Settings"
			style={{
				position: 'fixed',
				top,
				right: 0,
				bottom: 0,
				width: SETTINGS_WIDTH,
				maxWidth: '100vw',
				boxSizing: 'border-box',
				zIndex: Z_INDEX,
				background: GUI_THEME.panel2,
				borderLeft: `1px solid ${GUI_THEME.edge}`,
				boxShadow: '-10px 0 24px rgba(0, 0, 0, 0.45)',
				// None at the top: the header band carries the inset, as the
				// aside's does.
				padding: `0 ${ASIDE_PADDING}px ${ASIDE_PADDING}px`,
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
					padding: `${PANE_HEADER_INSET}px 0`,
					borderBottom: `1px solid ${GUI_THEME.line}`,
					flexShrink: 0,
				}}
			>
				<span style={{...SECTION_LABEL, fontSize: TEXT.meta, letterSpacing: 1}}>
					Settings
				</span>
				<Button variant="ghost" testId="close-settings" onClick={onClose}>
					close
				</Button>
			</div>

			{/* Everything under the band scrolls as one page. The gutter is
			    reserved rather than taken from the rows the moment a section
			    grows, on a platform whose scrollbar occupies layout space. */}
			<div
				ref={scroller}
				data-testid="settings-scroller"
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: 'auto',
					scrollbarGutter: 'stable',
				}}
			>
				{sections.map(spec => (
					<Fold
						key={spec.id}
						spec={spec}
						open={open.has(spec.id)}
						onToggle={() => toggle(spec.id)}
					/>
				))}
			</div>
		</div>
	);
};
