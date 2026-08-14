import {GUI_THEME} from '../lib/gui-theme';

// Scrollbars are the one piece of chrome this app can't style inline: they're
// reachable only through pseudo-elements (::-webkit-scrollbar) and the
// scrollbar-* properties, which React style objects can't express. So this
// renders a single global <style> tag instead — the same escape hatch
// TimeScrubber uses for its @keyframes, and the reason the colors are built
// from GUI_THEME here rather than hardcoded into index.html's own <style>,
// which has no way to read the theme.
//
// Rendered once at the app root; the rules are global, so every scroll
// container (board, swimlanes, the issue panel, code blocks) picks them up
// without each one having to opt in.
//
// Note this trades away macOS's auto-hiding overlay scrollbars: once
// ::-webkit-scrollbar is styled, the scrollbar becomes a permanent, layout-
// occupying element rather than a transient overlay. That's why the track is
// transparent and the thumb muted — a thin, always-present hairline that
// reads as part of the panel edge rather than a control sitting on top of it.
const SCROLLBAR_SIZE = 6;

export const GlobalScrollbarStyles = () => (
	<style>{`
		/* For engines with no ::-webkit-scrollbar support — Firefox, in
		   practice. Deliberately gated rather than applied unconditionally:
		   Chrome now implements the standard scrollbar-width/-color
		   properties too, and when either is set it takes that path and
		   ignores the ::-webkit-scrollbar rules below entirely. Setting both
		   globally therefore *lost* the 8px sizing and left Chrome at its own
		   "thin" (11px). "thin" is also the only width keyword the standard
		   property offers, so the two engines are matched by eye rather than
		   by an exact pixel value. */
		@supports not selector(::-webkit-scrollbar) {
			* {
				scrollbar-width: thin;
				scrollbar-color: ${GUI_THEME.dim} transparent;
			}
		}

		::-webkit-scrollbar {
			width: ${SCROLLBAR_SIZE}px;
			height: ${SCROLLBAR_SIZE}px;
		}

		/* Transparent rather than a tinted channel: the track would otherwise
		   draw a permanent stripe down every scrollable edge, which is exactly
		   the visual weight this is meant to avoid. */
		::-webkit-scrollbar-track {
			background: transparent;
		}

		::-webkit-scrollbar-thumb {
			background: ${GUI_THEME.dim};
			border-radius: 999px;
			/* Inset via a transparent border so the thumb reads as narrower
			   than the track it needs for a comfortable hit target. Only 1px
			   at this gutter width — 2px would leave a 2px thumb, thin enough
			   to lose against the panel. */
			border: 1px solid transparent;
			background-clip: content-box;
		}

		::-webkit-scrollbar-thumb:hover {
			background: ${GUI_THEME.secondary};
			background-clip: content-box;
		}

		/* Where a vertical and horizontal bar meet; left unpainted so it
		   doesn't show as a lighter square against the dark panel. */
		::-webkit-scrollbar-corner {
			background: transparent;
		}
	`}</style>
);
