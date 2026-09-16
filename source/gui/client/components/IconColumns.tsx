// The log divided into lanes: one box cut into three columns. Framed like the
// dock icons rather than drawn as bare strokes — IconBars and IconLaneStats are
// already three vertical lines, and this is a layout, not a chart.
export const IconColumns = ({size = 16}: {size?: number}) => (
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
		<rect x="3" y="4" width="18" height="16" rx="2" />
		<line x1="9" y1="4" x2="9" y2="20" />
		<line x1="15" y1="4" x2="15" y2="20" />
	</svg>
);
