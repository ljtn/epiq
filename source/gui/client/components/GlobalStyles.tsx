import {GUI_THEME, SANS_FONT} from '../lib/gui-theme';

// What a React style object cannot express — a font face, an element rule,
// pseudo-elements and the scrollbar-* properties — hence a global <style>.
// Styling ::-webkit-scrollbar also opts out of macOS's auto-hiding overlay
// bars, so the thumb is kept muted and the track transparent.
const SCROLLBAR_SIZE = 3;

export const GlobalStyles = () => (
	<style>{`
		/* Served beside main.js by build-gui.mjs: Inter's own Latin subset,
		   which keeps its alternates. Anything outside Latin falls back. */
		@font-face {
			font-family: Inter;
			font-style: normal;
			font-weight: 100 900;
			font-display: swap;
			src: url('/inter.woff2') format('woff2');
		}

		/* A button takes the platform's face rather than inheriting one. */
		button {
			font-family: ${SANS_FONT};
		}

		/* Inter's capital I with serifs, so I, l and 1 read apart. A face
		   without the alternate ignores it. */
		body,
		button,
		input,
		textarea,
		select {
			font-feature-settings: 'cv08';
		}

		/* Placeholders are a pseudo-element too. Unstyled they take the
		   browser's warm grey, which sits oddly against the palette. Half of
		   the dim: a hint of what goes here, under what is already there. */
		input::placeholder,
		textarea::placeholder {
			color: ${GUI_THEME.dim};
			opacity: 0.55;
		}

		/* Gated deliberately: Chrome implements scrollbar-width/-color too, and
		   setting either makes it ignore the ::-webkit-scrollbar rules below. */
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

		/* Transparent, or the track draws a permanent stripe down every edge. */
		::-webkit-scrollbar-track {
			background: transparent;
		}

		::-webkit-scrollbar-thumb {
			background: ${GUI_THEME.dim};
			border-radius: 999px;
			/* Insets the thumb below the track's hit target; 2px here would leave
			   it 2px wide and lost against the panel. */
			border: 1px solid transparent;
			background-clip: content-box;
		}

		::-webkit-scrollbar-thumb:hover {
			background: ${GUI_THEME.secondary};
			background-clip: content-box;
		}

		/* Unpainted, or the corner shows as a lighter square. */
		::-webkit-scrollbar-corner {
			background: transparent;
		}
	`}</style>
);
