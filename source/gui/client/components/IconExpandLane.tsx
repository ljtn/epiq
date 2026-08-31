// The mirror of IconCollapseLane: chevrons pushing outward from the bar, for
// the rail that is already collapsed.
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
		<polyline points="9 7 5 12 9 17" />
		<line x1="12" y1="5" x2="12" y2="19" />
		<polyline points="15 7 19 12 15 17" />
	</svg>
);
