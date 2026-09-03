// The transport glyphs. Stroked at the same weight as the rest of the icon set,
// so the player reads as part of a terminal's chrome rather than as a media
// widget dropped onto it.

export const IconPlay = ({size = 14}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M8 5.5 19 12 8 18.5Z" />
	</svg>
);

export const IconPause = ({size = 14}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		aria-hidden="true"
	>
		<line x1="9" y1="5.5" x2="9" y2="18.5" />
		<line x1="15" y1="5.5" x2="15" y2="18.5" />
	</svg>
);

export const IconReplay = ({size = 14}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M20 12a8 8 0 1 1-2.6-5.9" />
		<polyline points="20 3 20 8 15 8" />
	</svg>
);

export const IconClose = ({size = 14}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		aria-hidden="true"
	>
		<line x1="6" y1="6" x2="18" y2="18" />
		<line x1="18" y1="6" x2="6" y2="18" />
	</svg>
);

export const IconPopOut = ({size = 12}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<polyline points="14 4 20 4 20 10" />
		<line x1="20" y1="4" x2="12" y2="12" />
		<path d="M18 15v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
	</svg>
);
