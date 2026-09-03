// The player's transport glyphs. Filled rather than stroked, unlike the rest of
// the icon set: at the size a transport button wants they read as shapes, and a
// stroked triangle at 14px is a wireframe.

export const IconPlay = ({size = 16}: {size?: number}) => (
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<path d="M8 5.5v13l11-6.5z" fill="currentColor" />
	</svg>
);

export const IconPause = ({size = 16}: {size?: number}) => (
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
		<rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
	</svg>
);

export const IconReplay = ({size = 16}: {size?: number}) => (
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

export const IconClose = ({size = 16}: {size?: number}) => (
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
