// A line that turns back at the edge and carries on below: a diff wrapped.
export const IconWrapLines = ({size = 16}: {size?: number}) => (
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
		<line x1="3" y1="6" x2="21" y2="6" />
		<path d="M3 12h15a3 3 0 0 1 0 6h-4" />
		<polyline points="16 16 14 18 16 20" />
		<line x1="3" y1="18" x2="10" y2="18" />
	</svg>
);
