import {GUI_THEME} from '../lib/gui-theme';

// Scrollbars are reachable only through pseudo-elements and the scrollbar-*
// properties, which React style objects can't express, hence a global <style>.
// Styling ::-webkit-scrollbar also opts out of macOS's auto-hiding overlay
// bars, so the thumb is kept muted and the track transparent.
const SCROLLBAR_SIZE = 3;

export const GlobalScrollbarStyles = () => (
	<style>{`
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
