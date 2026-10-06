// Lines that run on past the edge: a diff scrolled sideways. The arrow is where
// the longest one leaves the frame.
export const IconScrollLines = ({size = 16}: {size?: number}) => (
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
		<line x1="3" y1="6" x2="14" y2="6" />
		<line x1="3" y1="12" x2="20" y2="12" />
		<polyline points="17 9 20 12 17 15" />
		<line x1="3" y1="18" x2="10" y2="18" />
	</svg>
);
