// The mirror of IconCollapseLane: chevrons pushing back outward, for the rail
// that is already collapsed.
export const IconExpandLane = ({size = 16}: {size?: number}) => (
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
		<polyline points="9 6 4 12 9 18" />
		<polyline points="15 6 20 12 15 18" />
	</svg>
);
