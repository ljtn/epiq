// Strata: three horizontal strands, with a line stepping down between them.
export const IconFlow = ({size = 16}: {size?: number}) => (
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
		<path d="M3 6h5l4 6h4l4 6h1" />
		<path d="M3 12h6" opacity="0.45" />
		<path d="M3 18h9" opacity="0.45" />
	</svg>
);
