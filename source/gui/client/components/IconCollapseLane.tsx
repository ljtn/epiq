// A panel squeezed shut: chevrons pressing inward against the edge it collapses
// to. The mirrored pair (IconExpandLane) pushes back out.
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
		<polyline points="5 7 9 12 5 17" />
		<line x1="12" y1="5" x2="12" y2="19" />
		<polyline points="19 7 15 12 19 17" />
	</svg>
);
