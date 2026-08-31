// The mirror of IconDockBottom: the panel attached to the right edge.
export const IconDockRight = ({size = 16}: {size?: number}) => (
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
		<line x1="14" y1="4" x2="14" y2="20" />
	</svg>
);
