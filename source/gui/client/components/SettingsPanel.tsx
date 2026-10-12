import {useEffect, useRef} from 'react';
import {CONTENT_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {SECTION_LABEL} from '../lib/identity-panel.style';
import {PANE_HEADER_INSET} from '../lib/pane-header.style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {ASIDE_PADDING} from './Aside';
import {Button} from './Button';

// The board's setup, as against its content: who the viewer is, what this
// machine does on its own, which repos are read. One panel from the right
// edge rather than a popover and a modal, so each setting has a fixed place
// and the board stays in view behind it.
//
// Built like the ticket aside — the same edge, shadow, padding and header
// band — and told apart from it by its face and its ground: the prose font
// over a surface one step up, where every panel about the board's work is
// monospace on the panel colour. It is about the system, not the work.

export type SettingsSection = 'identity' | 'repos';

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

export const SettingsPanel = ({
	section,
	onClose,
	children,
}: {
	// Which section the panel was opened for; it scrolls there.
	section: SettingsSection;
	onClose: () => void;
	children: React.ReactNode;
}) => {
	const panel = useDismissOnOutsideClick(true, onClose);
	const scroller = useRef<HTMLDivElement | null>(null);

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

	return (
		<div
			ref={panel}
			data-testid="settings-panel"
			role="dialog"
			aria-label="Settings"
			style={{
				position: 'fixed',
				top: 0,
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

			{/* Everything under the band scrolls as one page: the sections are
			    reached by scrolling, and the one the panel opened for is scrolled
			    to. The gutter is reserved rather than taken from the rows the
			    moment the list grows, on a platform whose scrollbar occupies
			    layout space. */}
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
				{children}
			</div>
		</div>
	);
};
