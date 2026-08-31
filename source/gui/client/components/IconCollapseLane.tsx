// A panel squeezed shut: two chevrons pressing inward. Drawn as just the pair —
// a centre bar between them collapses into the chevron tips at the 12px this
// renders at, and the three marks together read as a star rather than an arrow.
export const IconCollapseLane = ({size = 16}: {size?: number}) => (
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
		<polyline points="4 6 9 12 4 18" />
		<polyline points="20 6 15 12 20 18" />
	</svg>
);
